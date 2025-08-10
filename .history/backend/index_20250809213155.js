const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// --- CONFIGURATION ---
// IMPORTANT: Replace with your Google Cloud Project ID
const GCP_PROJECT_ID = 'firi-5d531'; 
const GEMINI_MODEL = 'gemini-2.5-pro'; // Use a powerful and cost-effective model

// --- EXPRESS APP SETUP ---
const app = express();
app.use(express.json({ limit: '10mb' })); // Increase limit for image uploads
app.use(cors()); // In production, you might want to restrict this to your frontend's domain

// --- SECRET & AI CLIENT INITIALIZATION ---
const secretClient = new SecretManagerServiceClient();
let geminiApiKey;
let firebaseConfig;
let genAI;

// Helper function to safely access secrets from Google Secret Manager
async function accessSecret(secretName) {
  const [version] = await secretClient.accessSecretVersion({
    name: `projects/${GCP_PROJECT_ID}/secrets/${secretName}/versions/latest`,
  });
  return version.payload.data.toString('utf8');
}

// Configuration to block minimal harmful content
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
    if (firebaseConfig) {
        res.status(200).json(JSON.parse(firebaseConfig));
    } else {
        console.error("Firebase config has not been loaded from Secret Manager.");
        res.status(500).json({ error: 'Server configuration is not available. Cannot initialize application.' });
    }
});

/**
 * Versatile endpoint for non-chat AI generation requests.
 * Handles simple text prompts, prompts with Google Search, and prompts requiring structured JSON output.
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
            generationConfig: config || {}, // Pass config like responseSchema, tools
            safetySettings
        });
        
        const result = await model.generateContent(contents);
        const response = result.response;

        // The frontend expects the full response object to correctly handle grounding metadata
        // and extract text. We will send back a simplified version of it.
        const responseText = response.text();
        res.status(200).json({
            text: responseText,
            candidates: response.candidates,
        });

    } catch (error) {
        console.error('Error in /api/generate:', error);
        res.status(500).json({ error: `Failed to generate content: ${error.message}` });
    }
});

/**
 * Endpoint to handle stateful chat conversations for the AI Coach and Mock Judge.
 * Supports system instructions and multimodal input (text and images).
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
             systemInstruction: systemInstruction || undefined, // Add system instruction if provided
             safetySettings
        });
        
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(message); // The `message` can be parts array or string
        const response = result.response;
        const responseText = response.text();
        
        res.status(200).json({ text: responseText });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({ error: `Failed to process chat message: ${error.message}` });
    }
});

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 8080;

// Fetch secrets on startup, then start the server.
// This is a critical pattern: fail fast if secrets are unavailable.
Promise.all([
    accessSecret('GEMINI_API_KEY'),
    accessSecret('FIREBASE_CONFIG')
]).then(([key, config]) => {
    geminiApiKey = key;
    firebaseConfig = config;

    // Initialize the GoogleAI client *after* fetching the key
    genAI = new GoogleGenerativeAI(geminiApiKey);

    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log('Secrets loaded and AI client initialized successfully.');
    });
}).catch(err => {
    console.error("FATAL: Could not fetch secrets on startup. Server will not start.", err);
    process.exit(1); // Exit the process with an error code
});