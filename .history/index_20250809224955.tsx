/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { marked } from "marked";
// Firebase imports (v9 compat syntax)
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
const BACKEND_URL = 'https://firi-secure-backend-511371691691.us-central1.run.app';

// --- IMPORTANT: Firebase Configuration is now fetched from a secure backend ---
// The hardcoded firebaseConfig object has been removed.
// The app now fetches this configuration from your '/api/config' endpoint on startup.
// This allows you to store your configuration securely (e.g., in Google Secret Manager).

// --- GLOBAL INSTANCES & STATE ---
const root = document.getElementById("root") as HTMLDivElement;
// The `ai` instance has been removed from the frontend. 
// All AI calls are now proxied through your secure backend.

// Firebase will be initialized dynamically after fetching the config.
let auth: firebase.auth.Auth;
let db: firebase.firestore.Firestore;

type View = "dashboard" | "guides" | "tools" | "results" | "project" | "membership";
type AuthStatus = "loading" | "initializing" | "signedIn" | "signedOut";
type AiTool = "abstract" | "title" | "category" | "judge";

type User = firebase.User;

interface ProjectIdea {
  id?: string;
  title: string;
  description: string;
  analysis: string;
  category: string;
  impact: number;
  rigor: number;
  novelty: number;
  wowFactor: number;
  resourcesHtml: string;
  createdAt?: any; // Can be Date or FieldValue
  timeline?: string;
  isFavorited?: boolean;
  localId?: string; // For temporary ideas
}

type ChatMessage = { role: "user" | "model"; content: string; image?: string };
type RecentQuery = { topic: string; timestamp: number };

interface AppState {
  authStatus: AuthStatus;
  user: User | null;
  isGuest: boolean;
  view: View;
  isLoading: boolean;
  error: string | null;
  tokens: number;
  isUpgradeModalOpen: boolean;
  // Dashboard state
  dashboardStats: { projects: number; coaching: number; guides: number };
  recentProjects: ProjectIdea[];
  recentQueries: RecentQuery[];
  favoritedProjects: ProjectIdea[];
  // Ideation flow state
  topic: string;
  subtopics: string;
  fieldAnalysis: string;
  generatedProjects: ProjectIdea[];
  sources: { uri: string; title: string }[];
  isIdeating: boolean;
  // Project detail state
  selectedProject: ProjectIdea | null;
  projectSource: 'dashboard' | 'ideation' | null;
  timeline: string | null;
  // Chat state is now just the history. The `Chat` object lives on the backend.
  chatHistory: ChatMessage[];
  workspacePanelLayout: string | null;
  // AI Tools state
  activeTool: AiTool;
  toolInput: { [key: string]: string };
  toolOutput: string;
  isToolLoading: boolean;
  judgeImage: { data: string; mimeType: string; previewUrl: string } | null;
  systemInstruction: string | null;
}

let state: AppState = {
  authStatus: "initializing", // Start in an initializing state
  user: null,
  isGuest: false,
  view: "dashboard",
  isLoading: false,
  error: null,
  tokens: 0,
  isUpgradeModalOpen: false,
  dashboardStats: { projects: 0, coaching: 0, guides: 0 },
  recentProjects: [],
  recentQueries: [],
  favoritedProjects: [],
  topic: "",
  subtopics: "",
  fieldAnalysis: "",
  generatedProjects: [],
  sources: [],
  isIdeating: false,
  selectedProject: null,
  projectSource: null,
  timeline: null,
  chatHistory: [],
  workspacePanelLayout: null,
  activeTool: "abstract",
  toolInput: {},
  toolOutput: "",
  isToolLoading: false,
  judgeImage: null,
  systemInstruction: null,
};

function setState(newState: Partial<AppState> | ((prevState: AppState) => Partial<AppState>)) {
    const oldState = { ...state };
    const updates = typeof newState === 'function' ? newState(oldState) : newState;
    state = { ...state, ...updates };
    render();

    // After rendering, check if we need to scroll any active chat.
    const chatViewIsActive = state.view === 'project' || (state.view === 'tools' && state.activeTool === 'judge');
    if (chatViewIsActive) {
        const chatContentChanged =
            JSON.stringify(oldState.chatHistory) !== JSON.stringify(state.chatHistory) ||
            oldState.isLoading !== state.isLoading;

        if (chatContentChanged) {
            requestAnimationFrame(() => {
                const chatContainer = document.getElementById("chat-container");
                if (chatContainer) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            });
        }
    }
}

function resetState() {
  state = {
    authStatus: "initializing",
    user: null,
    isGuest: false,
    view: "dashboard",
    isLoading: false,
    error: null,
    tokens: 0,
    isUpgradeModalOpen: false,
    dashboardStats: { projects: 0, coaching: 0, guides: 0 },
    recentProjects: [],
    recentQueries: [],
    favoritedProjects: [],
    topic: "",
    subtopics: "",
    fieldAnalysis: "",
    generatedProjects: [],
    sources: [],
    isIdeating: false,
    selectedProject: null,
    projectSource: null,
    timeline: null,
    chatHistory: [],
    workspacePanelLayout: null,
    activeTool: "abstract",
    toolInput: {},
    toolOutput: "",
    isToolLoading: false,
    judgeImage: null,
    systemInstruction: null,
  };
}

// --- ICONS ---
const ICON_DASHBOARD = `<svg viewBox="0 0 24 24"><path d="M10 13.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0-7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm5.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm1.5-12.5v18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Zm-2 1H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" fill="currentColor"></path></svg>`;
const ICON_GUIDES = `<svg viewBox="0 0 24 24"><path d="M19 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-1 18H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1-1Z" fill="currentColor"></path><path d="M9 14h6v2H9v-2Zm0-4h6v2H9v-2Z" fill="currentColor"></path></svg>`;
const ICON_TOOLS = `<svg viewBox="0 0 24 24"><path d="M16 11.2V3.425a1.5 1.5 0 0 0-3 0V10h-2V6.425a1.5 1.5 0 0 0-3 0V10H6V8.425a1.5 1.5 0 0 0-3 0v12.15a1.5 1.5 0 0 0 3 0V12h2v4.575a1.5 1.5 0 0 0 3 0V18h2v2.575a1.5 1.5 0 0 0 3 0v-9.35a3.503 3.503 0 0 0-2-.025Z" fill="currentColor"></path></svg>`;
const ICON_MEMBERSHIP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.103 0-2 .897-2 2v12c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V6c0-1.103-.897-2-2-2zM4 6h16v2H4V6zm0 12v-6h16.001l.001 6H4z"></path><path d="M6 14h6v2H6z"></path></svg>`;
const GOOGLE_ICON = `<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.574l6.19,5.238C42.022,35.619,44,30.035,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path></svg>`;
const ICON_SEND = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M3.47827 20.5217L21.0001 12L3.47827 3.47827L3.47826 10L15.0001 12L3.47826 14L3.47827 20.5217Z"></path></svg>`;
const ICON_RESIZER = `<svg width="10" height="24" viewBox="0 0 10 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="8" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="16" r="1" fill="currentColor"/></svg>`;
const ICON_DELETE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 6V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6H22V8H2V6H7ZM9 4V6H15V4H9Z"></path><path d="M4 9V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V9H4ZM8 11H10V18H8V11ZM14 11H16V18H14V11Z"></path></svg>`;
const ICON_TOKEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm0 3.343L10.343 7.07l-4.242.617 3.07 2.99-.724 4.226L12 12.878l3.553 1.868-.724-4.226 3.07-2.99-4.242-.617L12 5.343z"></path></svg>`;
const ICON_FAVORITE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z"></path></svg>`;
const ICON_CHEVRON = `<svg class="chevron-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"></path></svg>`;
const ICON_UPLOAD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14 14V4h-4v10H6l6 6 6-6h-4zM4 20h16v2H4v-2z"></path></svg>`;

// --- API HELPERS ---
/**
 * A wrapper for fetch to call the backend proxy.
 * @param endpoint The backend endpoint (e.g., '/api/generate').
 * @param body The request body.
 * @returns The JSON response from the backend.
 */
async function apiFetch(endpoint: string, body: object) {
    const response = await fetch(BACKEND_URL + endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: 'An unknown error occurred.' }));
        throw new Error(errorBody.error || `Request failed with status ${response.status}`);
    }

    return response.json();
}


// --- LOCAL STORAGE HELPERS ---
const RECENT_QUERIES_KEY = 'firi_recent_queries';

function getRecentQueries(): RecentQuery[] {
    try {
        const stored = localStorage.getItem(RECENT_QUERIES_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error("Failed to parse recent queries from localStorage", e);
        return [];
    }
}

function addRecentQuery(topic: string) {
    const queries = getRecentQueries();
    const filteredQueries = queries.filter(q => q.topic.toLowerCase() !== topic.toLowerCase());
    const newQueries = [{ topic, timestamp: Date.now() }, ...filteredQueries].slice(0, 10);
    localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(newQueries));
    setState({ recentQueries: newQueries });
}

function clearRecentQueries() {
    localStorage.removeItem(RECENT_QUERIES_KEY);
    setState({ recentQueries: [] });
}


// --- AUTHENTICATION & FIREBASE ---
async function handleSignIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    setState({ error: null }); // Clear previous errors
    await auth.signInWithPopup(provider);
    // onAuthStateChanged will handle the rest
  } catch (error: any) {
    console.error("Authentication Error:", error);
    if (error.code === 'auth/popup-closed-by-user') return;
    if (error.code === 'auth/api-key-not-valid') {
      setState({ error: "<strong>Firebase Configuration Error:</strong> The API key is invalid. This app cannot connect to its database. To fix this, you must replace the placeholder `firebaseConfig` object in the `index.tsx` file with the real configuration from your Firebase project. Please follow the setup instructions in the comments at the top of the `index.tsx` file." });
    } else if (error.code === 'auth/unauthorized-domain') {
        const helpfulError = `
            <strong>Firebase Configuration Error:</strong> This app's domain has not been authorized.
            <br><br>
            This is a security feature. To fix it, you must add your development domain to the list of authorized domains in your Firebase project.
            <br><br>
            <strong>Follow these steps:</strong>
            <ol style="margin: 1rem 0 0 1.5rem; padding-left: 1rem;">
                <li>Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">Firebase Console</a> and open your project.</li>
                <li>Navigate to the <strong>Authentication</strong> section.</li>
                <li>Click on the <strong>Settings</strong> tab.</li>
                <li>Under <strong>Authorized domains</strong>, click <strong>"Add domain"</strong>.</li>
                <li>Add <strong>localhost</strong> and click "Add".</li>
                <li>Add <strong>127.0.0.1</strong> as well, as some development environments use this address.</li>
            </ol>
            <br>
            After adding the domain(s), please refresh this page and try again.
        `;
        setState({ error: helpfulError });
    } else {
      setState({ error: `Failed to sign in. Please try again. (${error.code})` });
    }
  }
}

function handleGuestLogin() {
    const mockUser = {
        uid: 'guest-user',
        displayName: 'Guest Innovator',
        email: 'guest@firi.com',
        photoURL: `https://api.dicebear.com/8.x/bottts/svg?seed=guest&backgroundColor=2a3dbe,43b3ff`,
        providerId: 'guest',
        emailVerified: true,
        isAnonymous: true,
        metadata: {} as any,
        providerData: [],
        refreshToken: '',
        tenantId: null,
        phoneNumber: null,
        delete: async () => {},
        getIdToken: async () => '',
        getIdTokenResult: async () => ({} as any),
        reload: async () => {},
        toJSON: () => ({}),
    } as User;

    const sampleProjects: ProjectIdea[] = [
        { id: 'sample-1', title: 'Sample: The Effect of Music on Plant Growth', description: 'A foundational experiment investigating the impact of different music genres on the germination rate and growth of common houseplants.', category: 'Plant Biology', impact: 7, rigor: 6, novelty: 5, wowFactor: 7, resourcesHtml: '<ul><li>A few pots of the same plant (e.g., beans)</li><li>A music player with headphones</li><li>A ruler for measuring growth</li></ul>', analysis: '<p>This is a classic introductory project that teaches the scientific method, control variables, and data collection. It is a great starting point for aspiring biologists.</p>', timeline: '<h3>Phase 1: Research & Setup (1 Week)</h3><ul><li>Research different genres of music and form a hypothesis.</li><li>Purchase bean seeds, pots, and soil.</li><li>Set up 3-4 experimental groups (e.g., Classical, Rock, No Music).</li><li>Plant all seeds under identical conditions (light, water).</li></ul><h3>Phase 2: Experimentation (3 Weeks)</h3><ul><li>Play the designated music to each group for a set number of hours daily.</li><li>Measure plant height every 2-3 days and record in a logbook.</li><li>Take photos to document visual changes.</li></ul><h3>Phase 3: Analysis & Conclusion (1 Week)</h3><ul><li>Create graphs of your data (e.g., average height over time).</li><li>Analyze the results to see if your hypothesis was supported.</li><li>Write up your conclusion and prepare your presentation.</li></ul>', isFavorited: true },
        { id: 'sample-2', title: 'Sample: AI for Detecting Parkinson\'s from Voice Recordings', description: 'An advanced project to develop a machine learning model that can identify potential signs of Parkinson\'s disease from audio recordings of a person\'s voice.', category: 'Computer Science', impact: 10, rigor: 9, novelty: 8, wowFactor: 9, resourcesHtml: '<ul><li>Python with libraries like TensorFlow or Scikit-learn</li><li>A public dataset of voice recordings (e.g., from UCI Machine Learning Repository)</li><li>Basic knowledge of machine learning concepts</li></ul>', analysis: '<p>This is a high-impact project that sits at the intersection of healthcare and artificial intelligence. It has the potential for significant real-world application and demonstrates advanced computational skills.</p>', timeline: '<h3>Phase 1: Data & Environment Setup (1-2 Weeks)</h3><ul><li>Find and download a suitable public voice dataset.</li><li>Set up a Python environment with necessary libraries (TensorFlow, Pandas, etc.).</li><li>Explore and preprocess the data: clean it, split into training/testing sets.</li></ul><h3>Phase 2: Model Development (2-3 Weeks)</h3><ul><li>Research common audio feature extraction techniques (e.g., MFCCs).</li><li>Build and train a baseline machine learning model (e.g., SVM or a simple Neural Network).</li><li>Iterate on the model: tune hyperparameters, try different architectures.</li></ul><h3>Phase 3: Evaluation & Reporting (1-2 Weeks)</h3><ul><li>Evaluate your model\'s performance using metrics like accuracy, precision, and recall.</li><li>Analyze where your model succeeds and fails.</li><li>Write up your methods, results, and conclusions for your research paper.</li></ul>', isFavorited: false }
    ];

    setState({
        authStatus: 'signedIn',
        user: mockUser,
        isGuest: true,
        view: 'dashboard',
        tokens: 25,
        recentProjects: sampleProjects,
        favoritedProjects: sampleProjects.filter(p => p.isFavorited),
        dashboardStats: { projects: 2, coaching: 1, guides: 5 },
    });
}


function handleSignOut() {
  if (state.isGuest) {
      initializeApp(); // Just reset the app state to the login screen
      return;
  }
  auth.signOut().catch(error => {
    console.error("Sign Out Error:", error);
    setState({ error: "Failed to sign out." });
  });
}

async function fetchDashboardData(userId: string) {
  try {
    const projectsCollectionRef = db.collection("users").doc(userId).collection("projects");
    
    // Fetch all projects, ordered by creation date. This avoids a composite index.
    const allProjectsQuery = projectsCollectionRef.orderBy("createdAt", "desc");
    const allProjectsSnapshot = await allProjectsQuery.get();
    
    const allProjects: ProjectIdea[] = [];
    allProjectsSnapshot.forEach(doc => {
        allProjects.push({ id: doc.id, ...doc.data() } as ProjectIdea);
    });

    // Filter and slice on the client side
    const recentProjects = allProjects.slice(0, 5);
    const favoritedProjects = allProjects.filter(p => p.isFavorited);
    
    const totalProjects = allProjects.length;

    // For now, other stats are static
    const stats = { projects: totalProjects, coaching: 3, guides: 5 };

    setState({ recentProjects, favoritedProjects, dashboardStats: stats, error: null });

  } catch (error: any) {
    console.error("Error fetching dashboard data:", error);
    if (error.code === 'permission-denied') {
        setState({ error: "<strong>Database Access Denied:</strong> The app could not read your data. This is likely because your Firestore security rules are too restrictive. Please ensure your database was created in <strong>Test Mode</strong>, or update your rules in the Firebase Console (Firestore > Rules) to allow access for authenticated users." });
    } else {
        const defaultMessage = "Could not load dashboard data.";
        const errorMessage = error.message ? `${defaultMessage} (${error.code || 'UNKNOWN_ERROR'})` : defaultMessage;
        setState({ error: errorMessage });
    }
  }
}

/** Atomically consumes one token, updating state and Firestore. Returns false if unsuccessful. */
async function consumeToken(): Promise<boolean> {
    if (state.tokens <= 0) {
        if (!state.isGuest) {
            setState({ isUpgradeModalOpen: true, error: 'You are out of Research Tokens.', isLoading: false, isToolLoading: false, isIdeating: false });
        } else {
            setState({ error: 'You are out of guest tokens.', isLoading: false, isToolLoading: false, isIdeating: false });
        }
        return false;
    }

    const newTokens = state.tokens - 1;
    // Optimistic UI update
    setState({ tokens: newTokens });

    if (!state.isGuest && state.user) {
        try {
            const userDocRef = db.collection("users").doc(state.user.uid);
            await userDocRef.update({ tokens: firebase.firestore.FieldValue.increment(-1) });
        } catch (error) {
            console.error("Failed to decrement token in Firestore, reverting state", error);
            // Revert optimistic update on DB failure
            setState({ tokens: state.tokens + 1 });
            return false;
        }
    }
    return true;
}

async function handleUpgrade() {
    if (state.isGuest || !state.user) return;
    
    setState({ isLoading: true });
    
    const LIFETIME_TOKENS = 10000000;
    const userDocRef = db.collection("users").doc(state.user.uid);

    try {
        await userDocRef.update({ tokens: LIFETIME_TOKENS });
        setState({
            isLoading: false,
            tokens: LIFETIME_TOKENS,
            error: null,
            isUpgradeModalOpen: false, // Close modal on success
            view: 'dashboard' // Go to dashboard to see new tokens
        });
    } catch (error) {
        console.error("Upgrade failed:", error);
        setState({
            isLoading: false,
            error: "Your upgrade could not be processed. Please try again."
        });
    }
}

async function handleDeleteProject(event: Event) {
    event.stopPropagation(); // Prevent triggering the project link click
    const button = event.currentTarget as HTMLButtonElement;
    const projectId = button.dataset.projectId;

    if (!projectId || !state.user || state.isGuest) return;
    
    const allProjects = [...state.recentProjects, ...state.favoritedProjects];
    const projectTitle = allProjects.find(p => p.id === projectId)?.title || "this project";


    if (!confirm(`Are you sure you want to permanently delete "${projectTitle}"? This action cannot be undone.`)) {
        return;
    }

    const projectRows = document.querySelectorAll(`li[data-project-id="${projectId}"]`);
    projectRows.forEach(row => (row as HTMLLIElement).style.opacity = '0.5');


    try {
        const projectDocRef = db.collection("users").doc(state.user.uid).collection("projects").doc(projectId);
        await projectDocRef.delete();

        setState(prevState => ({
            recentProjects: prevState.recentProjects.filter(p => p.id !== projectId),
            favoritedProjects: prevState.favoritedProjects.filter(p => p.id !== projectId),
            dashboardStats: { ...prevState.dashboardStats, projects: prevState.dashboardStats.projects - 1 },
            error: null
        }));

    } catch (error) {
        console.error("Error deleting project:", error);
        projectRows.forEach(row => (row as HTMLLIElement).style.opacity = '1');
        setState({ error: "Failed to delete the project. Please try again." });
    }
}

async function handleToggleFavoriteProject(event: Event) {
    event.stopPropagation();
    const button = event.currentTarget as HTMLButtonElement;
    const projectId = button.dataset.projectId;

    if (!projectId || !state.user || state.isGuest) return;

    // Find current status from state to determine the new status
    const allProjects = [...state.recentProjects, ...state.favoritedProjects];
    const project = allProjects.find(p => p.id === projectId);
    if (!project) return;

    const newIsFavorited = !project.isFavorited;
    
    // Disable all matching buttons to prevent double-clicks
    document.querySelectorAll(`.favorite-project-btn[data-project-id="${projectId}"]`).forEach(btn => (btn as HTMLButtonElement).disabled = true);

    try {
        const projectDocRef = db.collection("users").doc(state.user.uid).collection("projects").doc(projectId);
        await projectDocRef.update({ isFavorited: newIsFavorited });
        // On success, refetch all data to ensure UI consistency
        await fetchDashboardData(state.user.uid);
    } catch (error) {
        console.error("Error toggling favorite:", error);
        setState({ error: "Failed to update favorite status." });
        // Re-enable buttons on error, though a refetch would also handle this
        document.querySelectorAll(`.favorite-project-btn[data-project-id="${projectId}"]`).forEach(btn => (btn as HTMLButtonElement).disabled = false);
    }
}

// --- RENDER FUNCTIONS ---
function render() {
  if (state.authStatus === "loading" || state.authStatus === 'initializing') {
    root.innerHTML = `<div class="loader-container"><div class="loader"></div><p style="margin-top: 1rem;">${state.authStatus === 'initializing' ? 'Connecting to backend...' : 'Loading...'}</p></div>`;
    return;
  }
  if (state.authStatus === "signedOut") {
    renderLogin();
    return;
  }
  if (state.authStatus === "signedIn") {
    renderAppLayout();
  }
}

// Helper function for rendering score bars
function renderScoreBar(label: string, score: number) {
    const percentage = score * 10;
    return `
        <div class="score-item">
            <label>${label}</label>
            <div class="score-bar-container">
                <div class="score-bar" style="width: ${percentage}%;"></div>
            </div>
            <span>${score}/10</span>
        </div>
    `;
};

function renderLogin() {
  root.innerHTML = `
    <div class="login-container">
      <div class="login-box">
        <div class="login-logo">
          <img src="FIRI_LOGO.png" alt="FIRI Logo"/>
          <h1>FIRI</h1>
        </div>
        <h2>Future Innovators Research Institute</h2>
        <p>Your AI-powered co-pilot for groundbreaking scientific research.</p>
        <br/>
        <button id="signin-btn" class="google-signin-btn">
          ${GOOGLE_ICON}
          Sign In with Google
        </button>
        <div class="separator">OR</div>
        <button id="guest-signin-btn" class="guest-signin-btn">
          Try a Demo as Guest
        </button>
        ${state.error ? `<div class="error-message">${state.error}</div>` : ""}
        <p>Access to FIRI is by invitation only. Please sign in to continue.</p>
      </div>
    </div>
  `;
  document.getElementById("signin-btn")?.addEventListener("click", handleSignIn);
  document.getElementById("guest-signin-btn")?.addEventListener("click", handleGuestLogin);
}

function renderAppLayout() {
  root.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar">
        ${renderSidebar()}
      </aside>
      <main class="main-content">
        ${renderMainContent()}
      </main>
    </div>
    ${state.isUpgradeModalOpen ? renderUpgradeModal() : ''}
  `;
  addSidebarEventListeners();
  addEventListenersForView();
}

function renderSidebar() {
  if (!state.user) return "";
  const hasLowTokens = state.tokens < 10 && !state.isGuest;
  return `
    <div class="sidebar-header">
      <div class="sidebar-logo"><img src="FIRI_LOGO.png" alt="FIRI Logo"/></div>
      <div class="sidebar-title">
        <h2>FIRI</h2>
        <p>Research Institute</p>
      </div>
    </div>
    <nav class="sidebar-nav">
      <ul>
        <li><button class="nav-btn ${state.view === 'dashboard' ? 'active' : ''}" data-view="dashboard">${ICON_DASHBOARD} Dashboard</button></li>
        <li><button class="nav-btn ${state.view === 'guides' ? 'active' : ''}" data-view="guides">${ICON_GUIDES} Research Guides</button></li>
        <li><button class="nav-btn ${state.view === 'tools' ? 'active' : ''}" data-view="tools">${ICON_TOOLS} AI Tools</button></li>
        <li><button class="nav-btn ${state.view === 'membership' ? 'active' : ''}" data-view="membership">${ICON_MEMBERSHIP} Membership</button></li>
      </ul>
    </nav>
    <div class="user-profile">
      ${!state.isGuest ? `
        <button class="token-counter-btn ${hasLowTokens ? 'low-tokens' : ''}" id="token-upgrade-btn">
          ${ICON_TOKEN}
          <span class="value">${state.tokens.toLocaleString()}</span>
          <span class="label">Research Tokens</span>
        </button>
      ` : ''}
      <div class="user-info">
        <img src="${state.user.photoURL || ''}" alt="User avatar" class="user-avatar">
        <div class="user-details">
          <p class="user-name">${state.user.displayName}</p>
          <p class="user-email">${state.user.email}</p>
        </div>
      </div>
      <button id="signout-btn" class="signout-btn">${state.isGuest ? 'Exit Guest Mode' : 'Sign Out'}</button>
    </div>
  `;
}

function renderMainContent() {
    switch (state.view) {
        case "dashboard": return renderDashboard();
        case "guides": return renderGuides();
        case "tools": return renderAiTools();
        case "results": return renderResults();
        case "project": return renderProjectView();
        case "membership": return renderMembershipPage();
        default: return renderDashboard();
    }
}

// --- VIEWS ---

function renderDashboard() {
  const { isIdeating } = state;
  const hasNoTokens = state.tokens <= 0 && !state.isGuest;
  return `
    <div class="page-header">
      <h1>Welcome back, ${state.user?.displayName?.split(' ')[0] || 'Innovator'}!</h1>
      <p>Let's continue your research journey. What will you discover today?</p>
    </div>
    ${state.error ? `<div class="error-message" style="margin-bottom: 1.5rem;">${state.error}</div>` : ""}
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-title">Projects Created</div>
        <div class="stat-card-value">${state.dashboardStats.projects}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-title">Coaching Sessions</div>
        <div class="stat-card-value">${state.dashboardStats.coaching}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-title">Guides Unlocked</div>
        <div class="stat-card-value">${state.dashboardStats.guides}</div>
      </div>
    </div>
    <div class="card">
      <h2>Start a New Project</h2>
      <p>Have an idea? Enter a topic below to explore related fields and generate project ideas.</p>
      ${hasNoTokens ? `<p class="feature-notice">You need more Research Tokens to brainstorm new projects.</p>` : ''}
      <br>
      <form id="ideation-form">
        <input type="text" id="topic-input" name="topic" placeholder="e.g., 'chemistry simulations'" required ${isIdeating || hasNoTokens ? 'disabled' : ''}/>
        <button type="submit" ${isIdeating || hasNoTokens ? 'disabled' : ''}>${isIdeating ? 'Generating...' : 'Brainstorm Projects'}</button>
      </form>
    </div>
    <div class="dashboard-columns">
        <div class="card recent-queries-list">
            <div class="recent-queries-header">
                <h3>Recent Brainstorms</h3>
                ${state.recentQueries.length > 0 ? `<button id="clear-history-btn">Clear History</button>` : ''}
            </div>
            ${state.recentQueries.length > 0 ? `
                <ul>
                    ${state.recentQueries.map(q => `
                        <li>
                            <button class="query-item-btn" data-topic="${q.topic}">${q.topic}</button>
                        </li>`).join('')}
                </ul>` : `<p class="placeholder-text">Your recent brainstorm topics will appear here.</p>`
            }
        </div>
        <div class="card favorited-projects-list">
             <h3>Favorited Projects</h3>
             ${state.favoritedProjects.length > 0 ? `
                <ul>
                  ${state.favoritedProjects.map(p => `
                    <li data-project-id="${p.id}">
                      <a href="#" class="project-link" data-project-id="${p.id}">${p.title}</a>
                      <div class="project-actions">
                         <button class="favorite-project-btn ${p.isFavorited ? 'favorited' : ''}" data-project-id="${p.id}" aria-label="Favorite project">${ICON_FAVORITE}</button>
                         <button class="delete-project-btn" data-project-id="${p.id}" aria-label="Delete project">${ICON_DELETE}</button>
                      </div>
                    </li>`).join('')}
                </ul>
             ` : `<p class="placeholder-text">Projects you favorite will be saved here for quick access.</p>`}
        </div>
    </div>
    <div class="recent-projects-list card" style="margin-top: 1.5rem;">
      <h2>Recent Projects</h2>
      ${state.recentProjects.length > 0 ? `
        <ul>
            ${state.recentProjects.map(p => `
                <li data-project-id="${p.id}">
                    <a href="#" class="project-link" data-project-id="${p.id}">${p.title}</a>
                    <div class="project-actions">
                        <button class="favorite-project-btn ${p.isFavorited ? 'favorited' : ''}" data-project-id="${p.id}" aria-label="Favorite project">${ICON_FAVORITE}</button>
                        <button class="delete-project-btn" data-project-id="${p.id}" aria-label="Delete project">${ICON_DELETE}</button>
                    </div>
                </li>`).join('')}
        </ul>` : `<p>You haven't created any projects yet.</p>`
      }
    </div>
  `;
}

function renderGuides() {
    return `
    <div class="page-header">
        <h1>Research Guides</h1>
        <p>Essential reading to guide your research from idea to presentation.</p>
    </div>
    <div class="guides-grid">
        <div class="guide-card card">
            <h3>How to Write a Research Paper</h3>
            <p>Learn the fundamental structure of a scientific paper, from abstract to conclusion.</p>
            <button disabled title="Coming Soon">Read More</button>
        </div>
        <div class="guide-card card">
            <h3>Choosing a Winning Topic</h3>
            <p>Discover strategies for identifying novel and impactful research questions.</p>
            <button disabled title="Coming Soon">Read More</button>
        </div>
        <div class="guide-card card">
            <h3>Data Analysis for Beginners</h3>
            <p>An introduction to statistical methods and data visualization techniques.</p>
            <button disabled title="Coming Soon">Read More</button>
        </div>
        <div class="guide-card card">
            <h3>Presenting Your Research</h3>
            <p>Tips and tricks for creating a compelling poster and oral presentation.</p>
            <button disabled title="Coming Soon">Read More</button>
        </div>
    </div>
    `;
}

function renderAiTools() {
    const hasNoTokens = state.tokens <= 0 && !state.isGuest;
    return `
    <div class="page-header">
      <h1>AI-Powered Research Tools</h1>
      <p>Optimize your project materials with state-of-the-art AI assistance.</p>
    </div>
    <div class="tools-tabs">
      <button class="tab-btn ${state.activeTool === 'abstract' ? 'active' : ''}" data-tool="abstract">Abstract Optimizer</button>
      <button class="tab-btn ${state.activeTool === 'title' ? 'active' : ''}" data-tool="title">Title Optimizer</button>
      <button class="tab-btn ${state.activeTool === 'category' ? 'active' : ''}" data-tool="category">Category Optimizer</button>
      <button class="tab-btn ${state.activeTool === 'judge' ? 'active' : ''}" data-tool="judge">AI Mock Judge</button>
    </div>
    ${hasNoTokens ? `<div class="error-message" style="margin-bottom: 1.5rem;">You're out of Research Tokens. Please add more from the sidebar to use these AI tools.</div>` : ''}
    <div class="tool-content">
      ${renderActiveTool()}
    </div>
    `;
}

function renderActiveTool() {
    const { activeTool, toolInput, toolOutput, isToolLoading } = state;
    const hasNoTokens = state.tokens <= 0 && !state.isGuest;
    switch (activeTool) {
        case "abstract":
            return `
              <div class="tool-container">
                  <div class="tool-input-col">
                      <form id="abstract-form" class="card">
                          <h3>Paste Your Abstract</h3>
                          <textarea id="abstract-input" placeholder="Enter your project abstract here..." required ${hasNoTokens ? 'disabled' : ''}>${toolInput.abstract || ''}</textarea>
                          <br>
                          <button type="submit" ${hasNoTokens ? 'disabled' : ''}>Optimize Abstract</button>
                      </form>
                  </div>
                  <div class="tool-output-col">
                      <div class="card">
                          <h3>Optimized Version</h3>
                          ${isToolLoading ? `<div class="loader-container"><div class="loader"></div></div>` : `<pre>${toolOutput || 'Your optimized abstract will appear here.'}</pre>`}
                      </div>
                  </div>
              </div>`;
        case "title":
            return `
              <div class="tool-container">
                  <div class="tool-input-col">
                      <form id="title-form" class="card">
                          <h3>Current Title</h3>
                          <input type="text" id="title-input" placeholder="Enter your current project title" value="${toolInput.title || ''}" required ${hasNoTokens ? 'disabled' : ''}/>
                          <br>
                          <h3>Project Description</h3>
                          <textarea id="title-desc-input" placeholder="Briefly describe your project..." required ${hasNoTokens ? 'disabled' : ''}>${toolInput.description || ''}</textarea>
                          <br>
                          <button type="submit" ${hasNoTokens ? 'disabled' : ''}>Suggest Titles</button>
                      </form>
                  </div>
                  <div class="tool-output-col">
                      <div class="card content-area">
                          <h3>Suggested Titles</h3>
                          ${isToolLoading ? `<div class="loader-container"><div class="loader"></div></div>` : (toolOutput || '<p>Suggested titles will appear here.</p>')}
                      </div>
                  </div>
              </div>`;
        case "category":
             return `
              <div class="tool-container">
                  <div class="tool-input-col">
                      <form id="category-form" class="card">
                          <h3>Project Abstract/Description</h3>
                          <textarea id="category-input" placeholder="Paste your abstract or a detailed project description..." required ${hasNoTokens ? 'disabled' : ''}>${toolInput.abstract || ''}</textarea>
                          <br>
                          <button type="submit" ${hasNoTokens ? 'disabled' : ''}>Suggest Categories</button>
                      </form>
                  </div>
                  <div class="tool-output-col">
                      <div id="category-results" class="card content-area">
                          <h3>Top Category Suggestions</h3>
                          ${isToolLoading ? `<div class="loader-container"><div class="loader"></div></div>` : (toolOutput || '<p>Category suggestions based on your abstract will appear here.</p>')}
                      </div>
                  </div>
              </div>`;
        case "judge":
            return `
              <div class="chat-column">
                  <h2>AI Mock Judge</h2>
                  <div id="chat-container" aria-live="polite">
                      ${state.chatHistory.map(msg => `
                        <div class="chat-message ${msg.role}">
                            ${msg.image ? `<img src="${msg.image}" class="chat-image" alt="User upload"/>` : ''}
                            ${msg.content ? marked.parse(msg.content) : ''}
                        </div>
                      `).join("")}
                      ${state.isLoading ? `<div class="chat-message model"><div class="loader"></div></div>` : ""}
                  </div>
                  <form id="chat-form">
                      ${state.judgeImage ? `
                        <div id="judge-image-preview">
                            <img src="${state.judgeImage.previewUrl}" alt="Image preview" />
                            <button type="button" id="remove-judge-image-btn" aria-label="Remove image">&times;</button>
                        </div>
                      ` : ''}
                      <label for="judge-image-upload" class="upload-btn" aria-label="Upload image">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M21.92,11.6C21.78,11.23,21.42,11,21,11H17.76L16,4.85C15.87,4.37,15.42,4,14.91,4H9.09C8.58,4,8.13,4.37,8,4.85L6.24,11H3c-0.42,0-0.78,0.23-0.92,0.6C1.94,12,2,12.44,2.29,12.71L11.29,21.71c0.39,0.39,1.02,0.39,1.41,0l9-9C22,12.44,22.06,12,21.92,11.6z M12,18.59L5.41,12H9.41l1.38-4.85C10.9,6.76,11.16,6,12,6s1.1,0.76,1.21,1.15L14.59,12H18.59L12,18.59z"></path></svg>
                      </label>
                      <input type="file" id="judge-image-upload" accept="image/*" class="sr-only">
                      <input type="text" id="chat-input" placeholder="${hasNoTokens ? 'Add tokens to chat' : 'Ask a question or describe your image...'}" required ${hasNoTokens ? 'disabled' : ''}/>
                      <button type="submit" aria-label="Send message" ${hasNoTokens ? 'disabled' : ''}>${ICON_SEND}</button>
                  </form>
              </div>`;
        default: return ``;
    }
}

function renderResults() {
    if (state.isLoading && state.generatedProjects.length === 0) {
        return `
            <div class="loader-container" style="flex-direction: column; gap: 1rem;">
                <div class="loader"></div>
                <h2>Analyzing the field of "${state.topic}"...</h2>
                <p>This may take a moment. We're consulting our digital archives and brainstorming innovative project ideas just for you.</p>
            </div>
        `;
    }

    if (state.error && state.view === 'results') {
        return `
            <div class="page-header">
                <h1>Something Went Wrong</h1>
                <p>We couldn't generate project ideas. Please try again.</p>
                <button id="back-to-dash-btn" style="margin-top: 1rem;">Back to Dashboard</button>
            </div>
            <div class="error-message">${state.error}</div>
        `;
    }

    return `
        <div class="page-header results-header">
            <div>
                <h1>Project Brainstorm: ${state.topic}</h1>
                <p>Here's our analysis and some project ideas to get you started.</p>
            </div>
            <button id="back-to-dash-btn">Back to Dashboard</button>
        </div>
        <div class="feature-notice" style="margin-bottom: 1.5rem;">These ideas are temporary. Select one to develop it into a full project and save it. You can favorite a project from the dashboard.</div>
        ${state.error ? `<div class="error-message" style="margin-bottom: 1.5rem;">${state.error}</div>` : ""}
        <div class="results-layout">
            <div class="results-main">
                <h2>Generated Project Ideas</h2>
                <div class="project-ideas-grid">
                    ${state.generatedProjects.map((p, i) => renderProjectIdeaCard(p, i)).join('')}
                    ${state.isLoading ? `<div class="card"><div class="loader-container"><div class="loader"></div><p>Generating project details...</p></div></div>` : ''}
                </div>
            </div>
            <aside class="results-sidebar">
                <div class="card">
                    <h3>Field Analysis</h3>
                    <div class="content-area">${state.fieldAnalysis}</div>
                </div>
                <div class="card">
                    <h3>Sources</h3>
                    ${state.sources.length > 0 ? `
                        <ul class="sources-list">
                            ${state.sources.map(s => `<li><a href="${s.uri}" target="_blank" rel="noopener noreferrer">${s.title}</a></li>`).join('')}
                        </ul>
                    ` : `<p>No web sources were found for this topic.</p>`}
                </div>
            </aside>
        </div>
    `;
}

function renderProjectIdeaCard(project: ProjectIdea, index: number) {
    return `
        <div class="project-idea-card card">
            <div class="idea-card-header">
                <h3>${project.title}</h3>
            </div>
            <span class="category-tag">${project.category}</span>
            <p>${project.description}</p>
            <div class="scores-container">
                ${renderScoreBar('Impact', project.impact)}
                ${renderScoreBar('Novelty', project.novelty)}
                ${renderScoreBar('Rigor', project.rigor)}
                ${renderScoreBar('Wow Factor', project.wowFactor)}
            </div>
            <h4>Starting Resources</h4>
            <div class="resources-list content-area">
              ${project.resourcesHtml || '<ul><li>No resources provided.</li></ul>'}
            </div>
            <button class="select-project-btn" data-project-index="${index}">Select & Develop this Idea</button>
        </div>
    `;
}

function renderProjectView() {
    if (state.isLoading && !state.selectedProject) {
        return `<div class="loader-container"><div class="loader"></div><h2>Saving your project...</h2></div>`;
    }

    if (!state.selectedProject) {
        return `
            <div class="page-header">
                <h1>Error</h1>
                <p>No project is currently selected.</p>
            </div>
            <div class="error-message">
                Something went wrong. Please go back to the dashboard and try again.
            </div>
             <button id="back-to-dash-btn" style="margin-top: 1.5rem;">Back to Dashboard</button>
        `;
    }
    const { title, description, category, impact, novelty, rigor, wowFactor, resourcesHtml, analysis } = state.selectedProject;
    const hasNoTokens = state.tokens <= 0 && !state.isGuest;
    const backButtonText = state.projectSource === 'ideation' ? 'Back to Ideas List' : 'Back to Dashboard';
    const workspaceStyle = state.workspacePanelLayout ? `style="grid-template-columns: ${state.workspacePanelLayout};"` : '';
    
    // Determine timeline content: could be HTML, a loading state, or an error/placeholder.
    let timelineContent = state.timeline;
    if (!state.timeline && state.selectedProject.id) {
        // This case is for a saved project that needs a timeline generated.
        timelineContent = `<div class="loader-container"><div class="loader"></div><p>Generating your research plan...</p></div>`;
    } else if (!state.timeline) {
        // This case is for unsaved projects (like favorites).
        timelineContent = `<div class="placeholder-text">A detailed timeline will be generated when you select this idea and develop it into a saved project.</div>`;
    }

    return `
        ${state.isGuest ? `
            <div class="guest-notice">
                <p>You are in Guest Mode. Your work here will not be saved.</p>
                <button id="signin-from-guest-btn">Sign In to Save</button>
            </div>
        ` : ''}
        <div class="page-header project-header">
            <div>
                <span class="category-tag">${category}</span>
                <h1>${title}</h1>
                <p>${description}</p>
            </div>
            <button id="back-nav-btn">${backButtonText}</button>
        </div>
        <div class="project-workspace-layout" ${workspaceStyle}>
            <div class="project-main-col resizable-panel">
                <details class="card" open>
                    <summary>${ICON_CHEVRON}<h3>Project Scorecard</h3></summary>
                    <div class="scores-container details-content">
                        ${renderScoreBar('Impact', impact)}
                        ${renderScoreBar('Novelty', novelty)}
                        ${renderScoreBar('Rigor', rigor)}
                        ${renderScoreBar('Wow Factor', wowFactor)}
                    </div>
                </details>
                 <details class="card" open>
                    <summary>${ICON_CHEVRON}<h3>Field Analysis</h3></summary>
                    <div class="content-area details-content">${analysis || ''}</div>
                </details>
                <details class="card" open>
                    <summary>${ICON_CHEVRON}<h3>Recommended Timeline & Next Steps</h3></summary>
                    <div id="timeline-container" class="content-area details-content">
                       ${timelineContent}
                    </div>
                </details>
                 <details class="card">
                    <summary>${ICON_CHEVRON}<h3>Initial Resources</h3></summary>
                    <div class="resources-list content-area details-content">
                      ${resourcesHtml}
                    </div>
                </details>
            </div>
            <div class="resizer" data-direction="horizontal">${ICON_RESIZER}</div>
            <aside class="project-sidebar-col resizable-panel">
                <div class="chat-column">
                    <h2>
                        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style="margin-right: 8px; flex-shrink: 0;"><path d="M12 11.55C9.64 9.35 6.48 8 3 8v11c3.48 0 6.64 1.35 9 3.55C14.36 20.35 17.52 19 21 19V8c-3.48 0-6.64 1.35-9 3.55Z"></path></svg>
                        AI Research Coach
                    </h2>
                    <div id="chat-container" aria-live="polite">
                        ${state.chatHistory.map(msg => `<div class="chat-message ${msg.role}">${marked.parse(msg.content)}</div>`).join("")}
                        ${state.isLoading && state.view === 'project' ? `<div class="chat-message model"><div class="loader"></div></div>` : ""}
                    </div>
                    <form id="chat-form">
                        <input type="text" id="chat-input" placeholder="${hasNoTokens ? 'Add tokens to chat' : 'Ask your coach...'}" required ${hasNoTokens ? 'disabled' : ''}/>
                        <button type="submit" aria-label="Send message" ${hasNoTokens ? 'disabled' : ''}>${ICON_SEND}</button>
                    </form>
                </div>
            </aside>
        </div>
    `;
}

function renderMembershipPage() {
    if (state.isGuest) {
        return `
            <div class="page-header">
                <h1>Membership</h1>
                <p>Membership features are disabled in Guest Mode.</p>
                <button id="signin-from-guest-btn" style="margin-top:1rem;">Sign In to Manage Membership</button>
            </div>
        `;
    }
    return `
        <div class="page-header">
            <h1>Membership & Tokens</h1>
            <p>Manage your token balance and upgrade for unlimited access.</p>
        </div>
        <div class="membership-layout">
            <div class="card current-balance-card">
                <h3>Your Balance</h3>
                <div class="token-display">
                    ${ICON_TOKEN}
                    <span>${state.tokens.toLocaleString()}</span>
                </div>
                <p>Research Tokens</p>
            </div>
            <div class="card upgrade-card">
                <h2>Lifetime Access</h2>
                <p>One-time payment. Unlimited potential.</p>
                <div class="price">$10 <span>USD</span></div>
                <ul>
                    <li><strong>10,000,000</strong> Research Tokens</li>
                    <li>Unlimited Project Ideation</li>
                    <li>Unlimited AI Tool Usage</li>
                    <li>Unlimited AI Coaching</li>
                    <li>Priority Access to Future Features</li>
                </ul>
                <form id="payment-form">
                  ${renderPaymentForm()}
                  <button id="upgrade-btn" type="submit" ${state.isLoading ? 'disabled' : ''}>
                    ${state.isLoading ? 'Processing...' : 'Pay & Upgrade Now'}
                  </button>
                </form>
                ${state.error ? `<div class="error-message" style="margin-top: 1rem;">${state.error}</div>` : ""}
            </div>
        </div>
    `;
}

function renderPaymentForm() {
    return `
        <div class="payment-form">
            <div class="payment-disclaimer">
                This is a simulation. <strong>Do not enter real credit card information.</strong>
            </div>
            <div class="form-group">
                <label for="card-number">Card Number</label>
                <input type="text" id="card-number" placeholder="1234 5678 9101 1121" />
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="expiry-date">Expiry Date</label>
                    <input type="text" id="expiry-date" placeholder="MM / YY" />
                </div>
                <div class="form-group">
                    <label for="cvc">CVC</label>
                    <input type="text" id="cvc" placeholder="123" />
                </div>
            </div>
        </div>
    `;
}

function renderUpgradeModal() {
    return `
    <div class="modal-overlay">
        <div class="modal-content">
            <button class="modal-close-btn" aria-label="Close">&times;</button>
            <div class="upgrade-view">
                <div class="card upgrade-card">
                    <h2>Lifetime Access</h2>
                    <p>One-time payment. Unlimited potential.</p>
                    <div class="price">$10 <span>USD</span></div>
                    <ul>
                        <li><strong>10,000,000</strong> Research Tokens</li>
                        <li>Unlimited Project Ideation</li>
                        <li>Unlimited AI Tool Usage</li>
                        <li>Unlimited AI Coaching</li>
                        <li>Priority Access to Future Features</li>
                    </ul>
                    <form id="payment-form">
                        ${renderPaymentForm()}
                        <button id="upgrade-btn" type="submit" ${state.isLoading ? 'disabled' : ''}>
                          ${state.isLoading ? 'Processing...' : 'Get Lifetime Access'}
                        </button>
                    </form>
                    ${state.error ? `<div class="error-message" style="margin-top: 1rem;">${state.error}</div>` : ""}
                </div>
            </div>
        </div>
    </div>
    `;
}


// --- EVENT HANDLERS & LOGIC ---

function addSidebarEventListeners() {
    document.getElementById("signout-btn")?.addEventListener("click", handleSignOut);
    document.querySelectorAll(".nav-btn").forEach(button => {
        button.addEventListener("click", (e) => {
            const view = (e.currentTarget as HTMLElement).dataset.view as View;
            // If we are leaving a view that uses the main 'chat' object, reset it to prevent context bleed.
            if (state.view === 'project' || (state.view === 'tools' && state.activeTool === 'judge')) {
                 setState({ view, error: null, chatHistory: [], judgeImage: null, workspacePanelLayout: null });
            } else {
                 setState({ view, error: null });
            }
        });
    });
    document.getElementById("token-upgrade-btn")?.addEventListener("click", () => {
        setState({ isUpgradeModalOpen: true, error: null });
    });
}

function addEventListenersForView() {
    if (state.isUpgradeModalOpen) {
        document.querySelector(".modal-overlay")?.addEventListener("click", (e) => {
            if (e.target === e.currentTarget) { // only if clicking the overlay itself
                setState({ isUpgradeModalOpen: false });
            }
        });
        document.querySelector(".modal-close-btn")?.addEventListener("click", () => setState({ isUpgradeModalOpen: false }));
        document.querySelector("#payment-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            await handleUpgrade();
        });
    }

    switch (state.view) {
        case "dashboard":
            document.getElementById("ideation-form")?.addEventListener("submit", handleIdeationSubmit);
            document.querySelectorAll(".project-link").forEach(link => {
                link.addEventListener("click", handleLoadProject);
            });
            document.querySelectorAll(".delete-project-btn").forEach(button => {
                button.addEventListener("click", handleDeleteProject);
            });
            document.querySelectorAll(".favorite-project-btn").forEach(button => {
                button.addEventListener("click", handleToggleFavoriteProject);
            });
            document.querySelectorAll(".query-item-btn").forEach(button => {
                button.addEventListener("click", handleRunRecentQuery);
            });
            document.getElementById("clear-history-btn")?.addEventListener("click", clearRecentQueries);
            break;
        case "results":
             document.getElementById("back-to-dash-btn")?.addEventListener("click", () => {
                setState({ view: "dashboard", error: null, topic: "", generatedProjects: [], fieldAnalysis: "", sources: [] });
            });
            document.querySelectorAll(".select-project-btn").forEach(button => {
                button.addEventListener("click", handleSelectProject);
            });
            break;
        case "tools":
            document.querySelectorAll(".tab-btn").forEach(button => {
                button.addEventListener("click", (e) => {
                    const tool = (e.currentTarget as HTMLElement).dataset.tool as AiTool;
                    // Reset chat if switching away from or to the judge tool
                    if(state.activeTool === 'judge' || tool === 'judge') {
                        setState({ activeTool: tool, toolOutput: "", toolInput: {}, chatHistory: [], judgeImage: null });
                    } else {
                        setState({ activeTool: tool, toolOutput: "", toolInput: {} });
                    }
                });
            });
            const toolForm = document.querySelector("#abstract-form, #title-form, #category-form, #chat-form");
            toolForm?.addEventListener("submit", handleToolSubmit);

            if(state.activeTool === 'judge'){
                document.getElementById('judge-image-upload')?.addEventListener('change', handleJudgeImageUpload);
                document.getElementById('remove-judge-image-btn')?.addEventListener('click', handleRemoveJudgeImage);

                if (state.chatHistory.length === 0) {
                  initializeJudgeChat();
                }
            }
            break;
        case "project":
            document.getElementById("back-nav-btn")?.addEventListener("click", () => {
                if (state.projectSource === 'ideation') {
                    // Go back to the ideas list, preserving the state
                    setState({ view: "results", selectedProject: null, timeline: null, chatHistory: [], error: null });
                } else {
                    // Go back to the dashboard
                    setState({ view: "dashboard", selectedProject: null, timeline: null, chatHistory: [], error: null });
                }
            });
            document.getElementById("chat-form")?.addEventListener("submit", handleCoachChatSubmit);
            if (state.isGuest) {
                document.getElementById("signin-from-guest-btn")?.addEventListener("click", handleSignIn);
            }
            
            // Initialize chat if this is the first render of this view for this project
            if (state.chatHistory.length === 0) {
                initializeProjectWorkspace();
            }

            // Generate timeline if it's missing (for older, SAVED projects)
            if (state.selectedProject && state.selectedProject.id && !state.timeline && !state.isGuest) {
                generateAndSaveTimelineForProject(state.selectedProject);
            }

            initializeResizer();
            break;
        case "membership":
             if (!state.isGuest) {
                 document.querySelector("#payment-form")?.addEventListener("submit", async (e) => {
                    e.preventDefault();
                    await handleUpgrade();
                });
             } else {
                document.getElementById("signin-from-guest-btn")?.addEventListener("click", handleSignIn);
             }
            break;
    }
}

function handleLoadProject(event: Event) {
    event.preventDefault();
    const projectId = (event.currentTarget as HTMLElement).dataset.projectId;
    if (!projectId) return;
    
    // Find project from either list
    const projectToLoad = state.recentProjects.find(p => p.id === projectId) || state.favoritedProjects.find(p => p.id === projectId);

    if (projectToLoad) {
        setState({
            view: 'project',
            selectedProject: projectToLoad,
            projectSource: 'dashboard',
            isLoading: false,
            timeline: projectToLoad.timeline || null, // Set timeline if it exists, otherwise it will be generated.
            chatHistory: [], // Will be initialized
            error: null,
        });
    } else {
        setState({ error: "Could not find the selected project. Please try again." });
    }
}

async function handleRunRecentQuery(event: Event) {
    const button = event.currentTarget as HTMLButtonElement;
    const topic = button.dataset.topic;
    if (!topic) return;

    const topicInput = document.getElementById("topic-input") as HTMLInputElement;
    if (topicInput) topicInput.value = topic;
    
    // Create a synthetic event to trigger the form submission handler
    const form = document.getElementById("ideation-form");
    if(form) {
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(submitEvent);
    }
}


async function handleIdeationSubmit(event: Event) {
    event.preventDefault();
    if (state.isIdeating) return;

    const topicInput = document.getElementById("topic-input") as HTMLInputElement;
    const topic = topicInput.value;
    if (!topic) return;
    
    addRecentQuery(topic);

    setState({
        view: "results",
        isLoading: true,
        isIdeating: true,
        topic,
        generatedProjects: [],
        fieldAnalysis: "",
        sources: [],
        error: null,
    });
    
    const canProceed = await consumeToken();
    if (!canProceed) {
        // consumeToken sets the error state and view
        setState({ isLoading: false, isIdeating: false, view: 'dashboard' }); // go back to dash
        return;
    }

    try {
        // --- Call 1: Field Analysis with Google Search ---
        const analysisPrompt = `You are a senior research scientist and grant reviewer. Your task is to provide a brief, insightful analysis of the research field: "${topic}".

1.  **Field Overview:** Briefly summarize the current state of this field, its key challenges, and recent breakthroughs. Keep this to 2-3 paragraphs.
2.  **Emerging Sub-Topics:** Identify 3-5 promising and specific sub-topics or niche areas that are ripe for novel research by a high school or undergraduate student. These should be cutting-edge but accessible.

Present your response clearly. Use markdown for formatting.`;

        const analysisResponse = await apiFetch('/api/generate', {
            contents: analysisPrompt,
            config: {
                tools: [{googleSearch: {}}],
            },
        });
        
        const fieldAnalysisText = analysisResponse.text;
        const groundingMetadata = analysisResponse.candidates?.[0]?.groundingMetadata;
        const webSources = groundingMetadata?.groundingChunks?.filter((c: any) => c.web).map((c: any) => c.web) || [];
        const uniqueSources: { uri: string; title: string }[] = [];
        const seenUris = new Set<string>();
        webSources.forEach((source: any) => {
            if (source && source.uri && !seenUris.has(source.uri)) {
                uniqueSources.push({ uri: source.uri, title: source.title || source.uri });
                seenUris.add(source.uri);
            }
        });

        const formattedFieldAnalysis = await marked.parse(fieldAnalysisText);

        // Update state with analysis so user sees something while projects generate
        setState({ fieldAnalysis: formattedFieldAnalysis, sources: uniqueSources });
        
        // --- Call 2: Generate Projects with JSON Schema ---
        const projectPrompt = `You are an AI research assistant specializing in ideating high-impact science fair projects. Based on the following analysis of the field of "${topic}", generate 5 innovative and feasible project ideas suitable for a high school or undergraduate student.

Field Analysis:
---
${fieldAnalysisText}
---

For each project idea, provide the following information in a JSON object. Return a JSON array of these objects.`;

        const schema = {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING', description: "A catchy and descriptive project title." },
                description: { type: 'STRING', description: "A concise, one-sentence summary of the project's goal and methodology." },
                category: { type: 'STRING', description: "The most relevant science fair category (e.g., 'Biochemistry')." },
                impact: { type: 'NUMBER', description: "Score from 1-10 on potential real-world impact." },
                rigor: { type: 'NUMBER', description: "Score from 1-10 on scientific rigor." },
                novelty: { type: 'NUMBER', description: "Score from 1-10 on how new the idea is." },
                wowFactor: { type: 'NUMBER', description: "Score from 1-10 on its potential to impress judges." },
                resourcesHtml: { type: 'STRING', description: "A bulleted list in HTML format (<ul><li>...</li></ul>) of 2-3 key resources a student could start with." },
              },
              required: ["title", "description", "category", "impact", "rigor", "novelty", "wowFactor", "resourcesHtml"],
            },
        };

        const projectResponse = await apiFetch('/api/generate', {
            contents: projectPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema
            }
        });
        
        const generatedProjects: ProjectIdea[] = JSON.parse(projectResponse.text).map((p: ProjectIdea) => {
            return {
                ...p,
                analysis: formattedFieldAnalysis,
            }
        });
        setState({ isLoading: false, generatedProjects, isIdeating: false });

    } catch(err) {
        console.error("Ideation Error:", err);
        setState({ isLoading: false, isIdeating: false, error: `Failed to generate ideas: ${(err as Error).message}` });
    }
}

async function handleSelectProject(event: Event) {
    const button = event.currentTarget as HTMLButtonElement;
    const projectIndex = parseInt(button.dataset.projectIndex!);
    const selectedProject = state.generatedProjects[projectIndex];
    if (!selectedProject) return;

    setState({ isLoading: true, view: "project", error: null, projectSource: 'ideation' });

    // For guests, we still "generate" the timeline but don't save to DB.
    if (state.isGuest) {
        const timelineHtml = await generateProjectTimeline(selectedProject, true); // Guest mode = true
        if (!timelineHtml) {
            setState({ view: "results", isLoading: false, error: "Could not generate project timeline." });
            return;
        }
        const projectData: ProjectIdea = {
            ...selectedProject,
            analysis: state.fieldAnalysis,
            timeline: timelineHtml,
        };
        setState({
            view: "project",
            selectedProject: projectData,
            timeline: timelineHtml,
            isLoading: false, 
            chatHistory: [],
        });
        return;
    }
    
    if (!state.user) return;

    // First, generate the timeline. This also consumes a token.
    const timelineHtml = await generateProjectTimeline(selectedProject);
    if (!timelineHtml) {
        setState({ view: "results", isLoading: false, error: "Could not generate project timeline. Please check your token balance and try again." });
        return;
    }

    try {
        const projectData: ProjectIdea = {
            ...selectedProject,
            analysis: state.fieldAnalysis,
            timeline: timelineHtml, // Save the generated timeline
            createdAt: new Date(),
            isFavorited: false, // Default to not favorited
        };
        delete projectData.id; 
        delete projectData.localId;
        
        const collectionRef = db.collection("users").doc(state.user.uid).collection("projects");
        const docRef = await collectionRef.add(projectData);
        const finalProject = { ...projectData, id: docRef.id };

        // After saving, refetch dashboard data to update all lists
        await fetchDashboardData(state.user.uid);

        setState(prevState => {
            return {
                selectedProject: finalProject,
                timeline: timelineHtml,
                isLoading: false,
                chatHistory: [],
                 // Clear ideation state after saving
                topic: '',
                generatedProjects: [],
                fieldAnalysis: '',
                sources: [],
            }
        });

    } catch (error: any) {
        console.error("Error saving project:", error);
        let errorMessage = `Could not save the project. Please try again. ${(error as Error).message}`;
        if (error.code === 'permission-denied') {
            errorMessage = "<strong>Database Access Denied:</strong> The project could not be saved. This is likely because your Firestore security rules are too restrictive. Please ensure your database was created in <strong>Test Mode</strong>, or update your rules in the Firebase Console (Firestore > Rules) to allow access for authenticated users.";
        }
        setState({ 
            view: "results",
            isLoading: false, 
            error: errorMessage
        });
    }
}

async function initializeProjectWorkspace() {
    if (!state.selectedProject) return;

    // Prime the coach with the current project's context.
    const { title, description } = state.selectedProject;
    const systemInstruction = `You are an encouraging and knowledgeable AI Research Coach. The student has selected the following project:
- Title: "${title}"
- Description: "${description}"

Your goal is to guide them. Start the conversation by congratulating them on their specific project choice and then ask a broad, open-ended question to get them started. For example: "This looks like a fascinating project! What's the very first thing that comes to mind when you think about tackling it?"
Don't have too long of a response, just a few sentences to get the conversation going, as well as for links to resources when appropriate.
I want you to help with things that they will most likely not have experience with, like:
- What tools may be needed for this project?
- How to break down the project into manageable steps?
- How to find relevant literature or resources?
- How to approach data collection and analysis?
But still tailor these questions to the specific project they are working on.
Be sure to ask questions that help them think critically about their project.
Be supportive, ask clarifying questions, help them break down complex tasks, and suggest resources. When suggesting resources, I want you to be very specific and actually look online for resources that you can link them to. If they are struggling too much, you can tell them the answer. Instead, empower them to find the answers themselves.`;
    
    setState({ isLoading: true });

    try {
        const initialResponse = await apiFetch('/api/chat', {
            history: [],
            message: "Hello, please provide your opening message to the student based on my system instructions.",
            systemInstruction
        });

        setState({
            chatHistory: [{ role: 'model', content: initialResponse.text }],
            isLoading: false,
        });
    } catch (err) {
        console.error("Error initializing coach chat", err);
        setState({
            chatHistory: [{ role: 'model', content: "Hello! I'm your AI Research coach. I had a little trouble starting up, but I'm ready to help now. What's on your mind?" }],
            isLoading: false,
        });
    }
}

async function generateProjectTimeline(project: ProjectIdea, isGuest: boolean = false): Promise<string | null> {
    if (!isGuest) {
      const canProceed = await consumeToken();
      if (!canProceed) return null;
    }

    const { title, description } = project;
    const prompt = `You are a project manager for a research institute. Create a detailed, actionable, step-by-step timeline for a student to complete the following research project.

Project Title: "${title}"
Project Description: "${description}"

The timeline should be broken down into logical phases (e.g., Phase 1: Background Research, Phase 2: Experimentation). Each phase should have a list of specific, actionable tasks. Format the entire output as a single block of HTML using <h3> for phases and <ul>/<li> for tasks. Do not include any other text or markdown characters like \`\`\`html.`;

    try {
        const response = await apiFetch('/api/generate', { contents: prompt });
        return response.text;
    } catch (error) {
        console.error("Timeline Generation Error:", error);
        return `<div class="error-message">Could not generate a timeline. ${(error as Error).message}</div>`;
    }
}

/** For projects created before the timeline feature, this generates and saves one. */
async function generateAndSaveTimelineForProject(project: ProjectIdea) {
    if (state.isGuest || !project.id || !state.user) return;
    
    const timelineHtml = await generateProjectTimeline(project);

    if (timelineHtml && state.user && project.id) {
        try {
            const projectDocRef = db.collection("users").doc(state.user.uid).collection("projects").doc(project.id);
            await projectDocRef.update({ timeline: timelineHtml });

            // Update local state for recent projects list
            const updatedRecentProjects = state.recentProjects.map(p => 
                p.id === project.id ? { ...p, timeline: timelineHtml } : p
            );

            setState({
                timeline: timelineHtml,
                selectedProject: { ...project, timeline: timelineHtml },
                recentProjects: updatedRecentProjects,
            });
        } catch (error) {
            console.error("Failed to save generated timeline:", error);
            setState({ timeline: `<div class="error-message">Could not save the generated timeline. It will be regenerated on next visit.</div>` });
        }
    } else {
        setState({ timeline: `<div class="error-message">Could not generate a timeline. Please check your token balance and reload.</div>` });
    }
}


async function handleCoachChatSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.querySelector("#chat-input") as HTMLInputElement;
    const message = input.value;
    if (!message) return;
    
    const currentUserHistory: ChatMessage[] = [...state.chatHistory, { role: "user", content: message }];
    input.value = "";
    
    setState({
        isLoading: true,
        chatHistory: currentUserHistory,
    });
    
    const canProceed = await consumeToken();
    if (!canProceed) {
        setState({ isLoading: false, chatHistory: [...currentUserHistory, {role: 'model', content: "I can't respond right now because you are out of Research Tokens."}] });
        return;
    }

    try {
        const response = await apiFetch('/api/chat', {
            history: currentUserHistory.slice(0, -1), // Send history *before* user's message
            message: { text: message }
        });
        setState({
            isLoading: false,
            chatHistory: [...currentUserHistory, { role: "model", content: response.text }],
        });
    } catch (err) {
        console.error(err);
        setState({
            isLoading: false,
            chatHistory: [...currentUserHistory, { role: "model", content: `Sorry, an error occurred: ${(err as Error).message}` }],
        });
    }
}

async function handleToolSubmit(event: Event) {
    event.preventDefault();
    if (state.activeTool === 'judge') {
        handleJudgeChatSubmit(event);
        return;
    }

    let prompt = "";
    let capturedInput = {};
    
    // Step 1: Read values from the DOM first to prevent them from being wiped by a state update.
    switch (state.activeTool) {
        case "abstract": {
            const abstract = (document.getElementById("abstract-input") as HTMLTextAreaElement)?.value;
            if (!abstract) return; // Prevent empty submission
            capturedInput = { abstract };
            prompt = `You are an expert academic editor. Your task is to revise the following science fair project abstract.\n- Ensure it is concise, clear, and impactful.\n- Correct any grammatical errors or awkward phrasing.\n- Structure it logically: Introduction/Purpose, Methods, Results, Conclusion.\n- The total length should not exceed 250 words.\n- Return ONLY the revised abstract as a single block of text.\n\nOriginal Abstract:\n---\n${abstract}\n---`;
            break;
        }
        case "title": {
            const title = (document.getElementById("title-input") as HTMLInputElement)?.value;
            const description = (document.getElementById("title-desc-input") as HTMLTextAreaElement)?.value;
            if (!title || !description) return; // Prevent empty submission
            capturedInput = { title, description };
            prompt = `You are a creative branding expert specializing in scientific communication. Based on the following project title and description, generate a list of 5 alternative titles. The titles should be catchy, informative, and professional.\n\nOriginal Title: ${title}\nProject Description: ${description}\n\nReturn the list in markdown format.`;
            break;
        }
        case "category": {
            const catAbstract = (document.getElementById("category-input") as HTMLTextAreaElement)?.value;
            if (!catAbstract) return; // Prevent empty submission
            capturedInput = { abstract: catAbstract };
            prompt = `You are an experienced science fair judge, an expert on ISEF categories. Your task is to recommend the most suitable categories for the given project abstract.
- Analyze the abstract carefully.
- Compare it against the provided list of science fair categories.
- Recommend the top 3 most appropriate categories.
- For each recommendation, provide a brief (1-2 sentence) justification explaining why it's a good fit.

Project Abstract:
---
${catAbstract}
---

Available Categories:
---
Jr & Sr ANIMAL BIOLOGY: Studies of evolutionary origins, genetics, growth, morphology, studies of animals in their natural habitat (or reproductions of it).
Jr & Sr ANIMAL PHYSIOLOGY: Studies of major animal organ system functions involving genetics, immunology, neurobiology, pathology, reproduction, or sensory biology in mammals.
Sr only BEHAVIORAL/SOCIAL SCIENCES: Studies of behavior, conditioned responses, learned responses, learning, psychiatry, or psychology in humans and other animals, including the effects of chemical or physical stress on mental processes, anthropology and archaeology; studies or surveys of attitudes, behaviors, or values of a society or groups within a society (e.g., anthropology, archaeology, or sociology)
Jr only BEHAVIORAL SCIENCES – NON-HUMAN: Studies of behavior, conditioned responses, learned responses, learning, psychiatry, or psychology in non-humans, including the effects of chemical or physical stress on mental processes.
Jr only BEHAVIORAL/SOCIAL SCIENCES – HUMAN: Studies of behavior, conditioned responses, learned responses, learning, psychiatry, or psychology in humans, including studies or surveys of attitudes, behaviors, or values of a society or groups within a society (e.g., anthropology, archaeology, or sociology), and the effects of chemical or physical stress on mental processes.
Jr & Sr BIOCHEMISTRY & MOLECULAR BIOLOGY: Molecular biology, molecular genetics, enzymes, photosynthesis, blood chemistry, protein chemistry, food chemistry, hormones.
Sr only CHEMISTRY: Physical chemistry, organic chemistry (other than biochemistry), inorganic chemistry, materials, plastics, fuels, pesticides, metallurgy, soil chemistry.
Jr only CHEMISTRY-APPLIED: Measures and comparisons of materials durability, flammability, effectiveness for intended use, and product testing for real world applications.
Jr only CHEMISTRY-GENERAL: Physical chemistry, organic chemistry (other than biochemistry), inorganic chemistry, materials, plastics, fuels, pesticides, metallurgy, soil chemistry. This implies knowledge of the chemical structure of the materials being tested.
Jr & Sr EARTH/SPACE SCIENCES: Geology, geophysics, physical oceanography, meteorology, atmospheric physics, seismology, petroleum geology, geography, speleology, mineralogy, topography, solar physics, astrophysics, orbital mechanics, observational astronomy and astronomical surveys.
Jr & Sr ECOLOGY: Interaction of abiotic and biotic elements within any environmental investigation (habitats, food webs, oxygen, carbon & nitrogen cycles, biogeography, biomes), pollution sources (air, land, water), impact studies, resource access, environmental alteration (caused by heat, light, irrigation, erosion, etc.).
Jr & Sr ENGINEERING APPLICATIONS: Project in which a potentially useful product is created (e.g., strengthening concrete, satellite reception improvement, solution to traffic jams, bionic heart/respiration monitors).
Jr & Sr ENGINEERING RESEARCH: Engineering analysis, tests of devices and their operations, other than product comparisons.
Jr & Sr ENVIRONMENTAL MANAGEMENT: Conservation of natural resources and usage modalities (crop rotation, use of renewable energy sources, terrace farming, recycling, clear cutting, etc.), environmental protections (emissions control, sewage and solid waste disposal, etc.)
Jr only MATERIALS SCIENCE: Studies of materials characteristics and their static physical properties. Includes measurements and comparisons of materials durability, flamability, and insulation properties (thermal, electrical, acoustic, optical, electromagnetic, etc.).
Jr & Sr MATHEMATICS & COMPUTER SCIENCES: Calculus, geometry, abstract algebra, number theory, statistics, complex analysis, probability, topology, logic, operations research, and other topics in pure and applied mathematics, computer programs, languages, new developments in software or hardware, information systems, computer systems organization, computer methodologies, and data (including structures, encryption, coding, and information theory) 
Jr & Sr MICROBIOLOGY: Studies of prokaryotes, protists (excluding algae), and fungi (mycology), including genetics, growth and reproduction, and response to chemical, and physical stress. Includes bacteriology.
Jr & Sr PHARMACOLOGY: Effect of any drug or chemical on any living animal, especially though not exclusively, humans. Studies should be at the cellular or organism level.
Sr only PHYSICS: Experimental or theoretical studies of the physical properties of matter in all forms, Computer simulations of physical systems are appropriate in this category.
Jr only PHYSICS – AERODYNAMICS/HYDRODYNAMICS: Studies of aerodynamics and propulsion of air, land, water, and space vehicles; aero/hydrodynamics of structures and natural objects. Studies of the basic physics of fluid flow.
Jr only PHYSICS – ELECTRICITY & MAGNETISM: Experimental or theoretical studies with electrical circuits, electro-optics, electromagnetic applications, antennas and propagation, and power production.
Jr only PHYSICS – GENERAL: Experimental or theoretical studies of the physical properties of matter and energy in all forms (with the exception of fluids, electricity, and magnetism); computer simulations of physical systems are appropriate in this category.
Jr & Sr PLANT BIOLOGY & PHYSIOLOGY: Agriculture, agronomy, horticulture, forestry, plant taxonomy, plant genetics, hydroponics, and phycology (algae); studies of major plant organ system functions involving genetics, immunology, pathology, and reproduction.
Jr only PRODUCT SCIENCE: Comparison and testing of natural and man-made products regarding effectiveness for their intended use in consumer-oriented applications.
---
Format your response as a markdown list. Example:
- **Category Name (CODE):** Justification for why this category is a strong fit.
`;
            break;
        }
    }

    setState({ isToolLoading: true, toolOutput: "", toolInput: capturedInput });

    const canProceed = await consumeToken();
    if (!canProceed) {
        setState({ isToolLoading: false, toolInput: capturedInput, toolOutput: `<div class="error-message">Could not run tool: you are out of tokens.</div>` });
        return;
    }

    try {
        const response = await apiFetch('/api/generate', { contents: prompt });
        const output = state.activeTool === 'abstract' ? response.text : await marked.parse(response.text);
        
        setState({ isToolLoading: false, toolOutput: output, toolInput: capturedInput });
    } catch (err) {
        console.error(err);
        setState({ isToolLoading: false, toolOutput: `<div class="error-message">Error: ${(err as Error).message}</div>`, toolInput: capturedInput });
    }
}


function handleJudgeImageUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert("Please select an image file.");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const base64String = dataUrl.split(',')[1];
        if (base64String) {
            setState({
                judgeImage: {
                    data: base64String,
                    mimeType: file.type,
                    previewUrl: dataUrl,
                }
            });
        }
    };
    reader.onerror = (error) => {
        console.error("FileReader error:", error);
        setState({ error: "Failed to read the selected image." });
    };
    reader.readAsDataURL(file);

    input.value = ""; // Allow re-selecting the same file
}

function handleRemoveJudgeImage() {
    setState({ judgeImage: null });
}

async function initializeJudgeChat() {
  const systemInstruction = `You are an AI Mock Science Fair Judge. Your persona is firm but fair, acting as a supportive mentor. Your goal is to critically evaluate the student's project based on the official Regeneron ISEF rubric to help them prepare. Your questions should be probing and constructive.

First, ask the user if their project is a 'Science' or 'Engineering' project. Do not proceed until they answer.

Once they specify the category, use the corresponding rubric's key areas to guide your questions. Ask one question at a time, focusing on one area before moving to the next.

Key Areas for Science Projects:
1. Research Question: Clarity, focus, contribution, testability.
2. Design & Methodology: Plan, data collection, variables, controls.
3. Execution: Data collection, analysis, reproducibility, statistical methods.
4. Creativity: Imagination and inventiveness in any part of the project.
5. Presentation & Interview: Understanding of science, interpretation, limitations, and future research.

Key Areas for Engineering Projects:
1. Research Problem: Practical need, criteria, constraints.
2. Design & Methodology: Exploration of alternatives, solution identification, prototype development.
3. Execution: Prototype construction and testing in multiple conditions.
4. Creativity: Imagination and inventiveness in any part of the project.
5. Presentation & Interview: Understanding of engineering principles, interpretation, limitations, and future research.

If the user uploads an image (like a chart, diagram, or photo), analyze it and ask a relevant question about what it shows in the context of their project.

Keep your responses concise. Your role is to question and probe for depth of understanding. Do not give answers or overly praise the student. Start the conversation by asking which project type they have.`;
  
  setState({ chatHistory: [{role: 'model', content: "I will be your mock judge today, following the Regeneron ISEF criteria. To begin, is your project a **Science** project or an **Engineering** project?"}], systemInstruction });
}


async function handleJudgeChatSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.querySelector("#chat-input") as HTMLInputElement;
    const messageText = input.value;
    const imageToSend = state.judgeImage;
    
    if ((!messageText || messageText.trim() === "") && !imageToSend) return;
    
    // Create the user message object for the history
    const userMessage: ChatMessage = {
        role: "user",
        content: messageText,
        ...(imageToSend && { image: imageToSend.previewUrl })
    };
    const currentUserHistory: ChatMessage[] = [...state.chatHistory, userMessage];
    
    // Clear inputs and set loading state
    input.value = "";
    setState({
        isLoading: true,
        chatHistory: currentUserHistory,
        judgeImage: null, // Clear the image preview
    });
    
    const canProceed = await consumeToken();
    if (!canProceed) {
        setState({ isLoading: false, chatHistory: [...currentUserHistory, {role: 'model', content: "I can't respond right now because you are out of Research Tokens."}] });
        return;
    }

    try {
        // Construct the message payload with parts for the backend
        const messageParts: any[] = [];
        if (imageToSend) {
            messageParts.push({
                inlineData: {
                    data: imageToSend.data,
                    mimeType: imageToSend.mimeType
                }
            });
        }
        if (messageText && messageText.trim() !== "") {
            messageParts.push({ text: messageText });
        }

        const apiPayload: any = {
            history: currentUserHistory.slice(0, -1),
            message: messageParts
        };

        if (state.systemInstruction) {
            apiPayload.systemInstruction = state.systemInstruction;
        }

        const response = await apiFetch('/api/chat', apiPayload);
        
        setState(prevState => ({
            isLoading: false,
            chatHistory: [...prevState.chatHistory, { role: "model", content: response.text }],
            systemInstruction: null, // Clear the instruction after the first use.
        }));

    } catch (err) {
        console.error(err);
         setState(prevState => ({
            isLoading: false,
            chatHistory: [...prevState.chatHistory, { role: "model", content: `Sorry, an error occurred: ${(err as Error).message}` }],
            systemInstruction: null, // Also clear on error
        }));
    }
}

function initializeResizer() {
    const resizer = document.querySelector('.resizer') as HTMLElement;
    if (!resizer) return;

    const leftPanel = resizer.previousElementSibling as HTMLElement;
    const rightPanel = resizer.nextElementSibling as HTMLElement;
    const container = resizer.parentElement as HTMLElement;

    if (!leftPanel || !rightPanel || !container) return;

    let x = 0;
    let leftWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
        const dx = e.clientX - x;
        const newLeftWidth = (leftWidth + dx);
        
        // Use percentages for flexible resizing
        const containerWidth = container.offsetWidth;
        const newLeftPercentage = (newLeftWidth / containerWidth) * 100;

        // Add constraints
        if (newLeftPercentage > 25 && newLeftPercentage < 75) {
            const newRightPercentage = 100 - newLeftPercentage;
            container.style.gridTemplateColumns = `${newLeftPercentage}% 10px ${newRightPercentage}%`;
        }
    };

    const onMouseUp = () => {
        // Persist the final layout to state
        if (container.style.gridTemplateColumns) {
            setState({ workspacePanelLayout: container.style.gridTemplateColumns });
        }
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        resizer.style.removeProperty('cursor');
        document.body.style.removeProperty('cursor');
        leftPanel.style.removeProperty('user-select');
        leftPanel.style.removeProperty('pointer-events');
        rightPanel.style.removeProperty('user-select');
        rightPanel.style.removeProperty('pointer-events');
    };

    const onMouseDown = (e: MouseEvent) => {
        x = e.clientX;
        leftWidth = leftPanel.getBoundingClientRect().width;
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        
        resizer.style.cursor = 'col-resize';
        document.body.style.cursor = 'col-resize';
        leftPanel.style.userSelect = 'none';
        leftPanel.style.pointerEvents = 'none';
        rightPanel.style.userSelect = 'none';
        rightPanel.style.pointerEvents = 'none';
    };

    resizer.addEventListener('mousedown', onMouseDown);
}


// --- INITIALIZATION ---
async function initializeApp() {
  resetState();
  
  try {
    // Fetch the Firebase config from the backend
    const response = await fetch('/api/config');
    if (!response.ok) {
        throw new Error(`Backend config fetch failed with status ${response.status}. Make sure your backend proxy is running.`);
    }
    const firebaseConfig = await response.json();

    // Initialize Firebase with the fetched config
    const app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();

    const initialQueries = getRecentQueries();
    
    auth.onAuthStateChanged(async (user) => {
      if (user) {
          setState({ authStatus: "loading" }); // Show loading while fetching user data
          const userDocRef = db.collection("users").doc(user.uid);
          const userDocSnap = await userDocRef.get();
          let tokenCount = 0;

          if (userDocSnap.exists) {
              const userData = userDocSnap.data();
              if (userData && userData.tokens !== undefined) {
                  tokenCount = userData.tokens;
              } else {
                  // User exists but has no token field (old user), grant them tokens
                  tokenCount = 25;
                  await userDocRef.set({ tokens: tokenCount }, { merge: true });
              }
          } else {
              // New user, create their document with initial tokens
              tokenCount = 25;
              await userDocRef.set({
                  displayName: user.displayName,
                  email: user.email,
                  photoURL: user.photoURL,
                  lastLogin: new Date(),
                  tokens: tokenCount
              }, { merge: true });
          }

          setState({ authStatus: "signedIn", user, view: 'dashboard', isGuest: false, error: null, tokens: tokenCount, recentQueries: initialQueries });
          await fetchDashboardData(user.uid);
      } else {
        setState({ authStatus: "signedOut", recentQueries: initialQueries, error: null });
      }
    });
  } catch (error) {
      console.error("Failed to initialize app:", error);
      setState({ authStatus: "signedOut", error: `<strong>Fatal Error:</strong> Could not connect to the backend to get configuration. Please ensure your backend service is running and accessible. <br><br><i>${(error as Error).message}</i>` });
  }
}

initializeApp();