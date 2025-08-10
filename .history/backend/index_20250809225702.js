const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// --- CONFIGURATION ---
const GCP_PROJECT_ID = 'firi-5d531';
const GEMINI_MODEL = 'gemini-1.5-pro-latest'; // Updated to a modern, powerful model

// --- EXPRESS APP SETUP ---
const app = express();
app.use(express.json({ limit: '10mb' })); // Adjusted limit for image uploads
app.use(cors());

// --- SECRET & AI CLIENT INITIALIZATION ---
const secretClient = new SecretManagerServiceClient();
let geminiApiKey;
let firebaseConfig; // This will now hold the PARSED JSON object
let genAI;

// Helper function to safely access secrets from Google Secret Manager
async function accessSecret(secretName) {
    const [version] = await secretClient.accessSecretVersion({
        name: `projects/${GCP_PROJECT_ID}/secrets/${secretName}/versions/latest`,
    });
    return version.payload.data.toString('utf8');
}

// Configuration to block harmful content
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// --- API ENDPOINTS ---

/**
 * Endpoint to provide the public Firebase config to the frontend.
 * This is called on app startup.
 */
app.get('/api/config', (req, res) => {
    // FIX: Directly send the pre-parsed JavaScript object.
    // Express's res.json() will handle stringifying it correctly.
    if (firebaseConfig) {
        res.status(200).json(firebaseConfig);
    } else {
        console.error("Firebase config has not been loaded from Secret Manager.");
        res.status(500).json({ error: 'Server configuration is not available. Cannot initialize application.' });
    }
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

/**
 * Versatile endpoint for non-chat AI generation requests.
 */
app.post('/api/generate', async (req, res) => {
    if (!genAI) {
        return res.status(500).json({ error: 'AI service is not initialized.' });
    }

    try {
        const { contents, config } = req.body;
        if (!contents) {
            return res.status(400).json({ error: 'Request body must include "contents".' });
        }

        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            generationConfig: config || {},
            safetySettings
        });

        const result = await model.generateContent(contents);
        const response = result.response;

        // The frontend expects the full response object for grounding metadata
        res.status(200).json({
            text: response.text(),
            candidates: response.candidates,
        });

    } catch (error) {
        console.error('Error in /api/generate:', error);
        res.status(500).json({ error: `Failed to generate content: ${error.message}` });
    }
});

/**
 * Endpoint to handle stateful chat conversations.
 */
app.post('/api/chat', async (req, res) => {
    if (!genAI) {
        return res.status(500).json({ error: 'AI service is not initialized.' });
    }

    try {
        const { history, message, systemInstruction } = req.body;
        if (!history || !message) {
            return res.status(400).json({ error: 'Request body must include "history" and "message".' });
        }

        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            systemInstruction: systemInstruction || undefined,
            safetySettings
        });

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(message);
        const response = result.response;

        res.status(200).json({ text: response.text() });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({ error: `Failed to process chat message: ${error.message}` });
    }
});

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 8080;

// Fetch secrets and initialize the server.
Promise.all([
    accessSecret('GEMINI_API_KEY'),
    accessSecret('FIREBASE_CONFIG')
]).then(([key, configString]) => {
    geminiApiKey = key;

    // FIX: Parse the config string into an object here, at startup.
    // This follows the "fail fast" principle. If the config is invalid,
    // the server will not start, which is better than crashing later.
    try {
        firebaseConfig = JSON.parse(configString);
    } catch (parseError) {
        console.error("FATAL: Could not parse FIREBASE_CONFIG secret as JSON.", parseError);
        process.exit(1);
    }

    // Initialize the GoogleAI client *after* fetching the key
    genAI = new GoogleGenerativeAI(geminiApiKey);

    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log('Secrets loaded and AI client initialized successfully.');
    });
}).catch(err => {
    console.error("FATAL: Could not fetch secrets on startup. Server will not start.", err);
    process.exit(1);
});