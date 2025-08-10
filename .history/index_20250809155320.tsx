/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type, Chat } from "@google/genai";
import { marked } from "marked";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  addDoc
} from "firebase/firestore";

// --- IMPORTANT: Firebase Configuration ---
// To use this app, you need to set up your own Firebase project.
// 1. Go to the Firebase console (https://console.firebase.google.com/).
// 2. Create a new project.
// 3. Go to Project Settings -> General, and find your web app config.
// 4. Replace the placeholder object below with your actual config.
// 5. In the Firebase console, go to "Authentication" -> "Sign-in method" and enable "Google".
// 6. Go to "Firestore Database" and create a database in test mode to get started.
const firebaseConfig = {
  apiKey: "AIzaSyA-9o6V89KKxAOx8ncqFN9SCh69rNWCEtg",
  authDomain: "firi-5d531.firebaseapp.com",
  projectId: "firi-5d531",
  storageBucket: "firi-5d531.appspot.com", 
  messagingSenderId: "511371691691",
  appId: "1:511371691691:web:1dd40e992f3c951025d9ee"
};

// --- GLOBAL INSTANCES & STATE ---
const root = document.getElementById("root") as HTMLDivElement;
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

type View = "dashboard" | "guides" | "tools" | "results" | "project";
type AuthStatus = "loading" | "signedIn" | "signedOut";
type AiTool = "abstract" | "title" | "category" | "judge";

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
  createdAt?: Date;
}

type ChatMessage = { role: "user" | "model"; content: string };

interface AppState {
  authStatus: AuthStatus;
  user: User | null;
  view: View;
  isLoading: boolean;
  error: string | null;
  // Dashboard state
  dashboardStats: { projects: number; coaching: number; guides: number };
  recentProjects: ProjectIdea[];
  // Ideation flow state
  topic: string;
  subtopics: string;
  fieldAnalysis: string;
  generatedProjects: ProjectIdea[];
  sources: { uri: string; title: string }[];
  // Project detail state
  selectedProject: ProjectIdea | null;
  timeline: any | null;
  chat: Chat | null;
  chatHistory: ChatMessage[];
  // AI Tools state
  activeTool: AiTool;
  toolInput: { [key: string]: string };
  toolOutput: string;
  isToolLoading: boolean;
}

let state: AppState = {
  authStatus: "loading",
  user: null,
  view: "dashboard",
  isLoading: false,
  error: null,
  dashboardStats: { projects: 0, coaching: 0, guides: 0 },
  recentProjects: [],
  topic: "",
  subtopics: "",
  fieldAnalysis: "",
  generatedProjects: [],
  sources: [],
  selectedProject: null,
  timeline: null,
  chat: null,
  chatHistory: [],
  activeTool: "abstract",
  toolInput: {},
  toolOutput: "",
  isToolLoading: false,
};

function setState(newState: Partial<AppState>) {
  const oldState = { ...state };
  state = { ...state, ...newState };
  render();
  // Add post-render logic if needed, e.g., scrolling chat
  if (JSON.stringify(oldState.chatHistory) !== JSON.stringify(state.chatHistory)) {
      const chatContainer = document.getElementById("chat-container");
      if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function resetState() {
  state = {
    authStatus: "loading",
    user: null,
    view: "dashboard",
    isLoading: false,
    error: null,
    dashboardStats: { projects: 0, coaching: 0, guides: 0 },
    recentProjects: [],
    topic: "",
    subtopics: "",
    fieldAnalysis: "",
    generatedProjects: [],
    sources: [],
    selectedProject: null,
    timeline: null,
    chat: null,
    chatHistory: [],
    activeTool: "abstract",
    toolInput: {},
    toolOutput: "",
    isToolLoading: false,
  };
}

// --- ICONS ---
const ICON_DASHBOARD = `<svg viewBox="0 0 24 24"><path d="M10 13.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0-7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm5.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm1.5-12.5v18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Zm-2 1H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" fill="currentColor"></path></svg>`;
const ICON_GUIDES = `<svg viewBox="0 0 24 24"><path d="M19 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-1 18H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1-1Z" fill="currentColor"></path><path d="M9 14h6v2H9v-2Zm0-4h6v2H9v-2Z" fill="currentColor"></path></svg>`;
const ICON_TOOLS = `<svg viewBox="0 0 24 24"><path d="M16 11.2V3.425a1.5 1.5 0 0 0-3 0V10h-2V6.425a1.5 1.5 0 0 0-3 0V10H6V8.425a1.5 1.5 0 0 0-3 0v12.15a1.5 1.5 0 0 0 3 0V12h2v4.575a1.5 1.5 0 0 0 3 0V18h2v2.575a1.5 1.5 0 0 0 3 0v-9.35a3.503 3.503 0 0 0-2-.025Z" fill="currentColor"></path></svg>`;
const FIRI_LOGO_SVG = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M50 0L93.3 25V75L50 100L6.7 75V25L50 0Z" fill="url(#paint0_linear_1_2)"/><path d="M50 8L87.5 30V70L50 92L12.5 70V30L50 8Z" stroke="url(#paint1_linear_1_2)" stroke-width="4"/><path d="M30 40L50 50L70 40L50 30L30 40Z" fill="white" fill-opacity="0.8"/><path d="M50 50V75L70 65V40L50 50Z" fill="#43B3FF" fill-opacity="0.7"/><path d="M50 50V75L30 65V40L50 50Z" fill="#4F46E5" fill-opacity="0.7"/><defs><linearGradient id="paint0_linear_1_2" x1="50" y1="0" x2="50" y2="100" gradientUnits="userSpaceOnUse"><stop stop-color="#2a3dbe"/><stop offset="1" stop-color="#0d1117"/></linearGradient><linearGradient id="paint1_linear_1_2" x1="50" y1="8" x2="50" y2="92" gradientUnits="userSpaceOnUse"><stop stop-color="#43B3FF"/><stop offset="1" stop-color="#4F46E5"/></linearGradient></defs></svg>`;
const GOOGLE_ICON = `<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.574l6.19,5.238C42.022,35.619,44,30.035,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path></svg>`;
const ICON_SEND = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M3.47827 20.5217L21.0001 12L3.47827 3.47827L3.47826 10L15.0001 12L3.47826 14L3.47827 20.5217Z"></path></svg>`;

// --- AUTHENTICATION & FIREBASE ---
async function handleSignIn() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    // Create a user document in Firestore if it doesn't exist
    await setDoc(doc(db, "users", user.uid), {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      lastLogin: new Date()
    }, { merge: true });
  } catch (error) {
    console.error("Authentication Error:", error);
    setState({ error: "Failed to sign in. Please try again." });
  }
}

function handleSignOut() {
  signOut(auth).catch(error => {
    console.error("Sign Out Error:", error);
    setState({ error: "Failed to sign out." });
  });
}

async function fetchDashboardData(userId: string) {
  try {
    const projectsQuery = query(
        collection(db, "users", userId, "projects"),
        orderBy("createdAt", "desc"),
        limit(5)
    );
    const querySnapshot = await getDocs(projectsQuery);
    const recentProjects: ProjectIdea[] = [];
    querySnapshot.forEach(doc => {
        recentProjects.push({ id: doc.id, ...doc.data() } as ProjectIdea);
    });

    // For now, other stats are static
    const stats = { projects: recentProjects.length, coaching: 3, guides: 5 };

    setState({ recentProjects, dashboardStats: stats });

  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    setState({ error: "Could not load dashboard data." });
  }
}


// --- RENDER FUNCTIONS ---
function render() {
  if (state.authStatus === "loading") {
    root.innerHTML = `<div class="loader-container"><div class="loader"></div></div>`;
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
          ${FIRI_LOGO_SVG}
          <h1>FIRI</h1>
        </div>
        <h2>Future Innovators Research Institute</h2>
        <p>Your AI-powered co-pilot for groundbreaking scientific research.</p>
        <br/>
        <button id="signin-btn" class="google-signin-btn">
          ${GOOGLE_ICON}
          Sign In with Google
        </button>
        ${state.error ? `<div class="error-message">${state.error}</div>` : ""}
        <p>Access to FIRI is by invitation only. Please sign in to continue.</p>
      </div>
    </div>
  `;
  document.getElementById("signin-btn")?.addEventListener("click", handleSignIn);
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
  `;
  addSidebarEventListeners();
  addEventListenersForView();
}

function renderSidebar() {
  if (!state.user) return "";
  return `
    <div class="sidebar-header">
      <div class="sidebar-logo">${FIRI_LOGO_SVG}</div>
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
      </ul>
    </nav>
    <div class="user-profile">
      <div class="user-info">
        <img src="${state.user.photoURL || ''}" alt="User avatar" class="user-avatar">
        <div class="user-details">
          <p class="user-name">${state.user.displayName}</p>
          <p class="user-email">${state.user.email}</p>
        </div>
      </div>
      <button id="signout-btn" class="signout-btn">Sign Out</button>
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
        default: return renderDashboard();
    }
}

// --- VIEWS ---

function renderDashboard() {
  return `
    <div class="page-header">
      <h1>Welcome back, ${state.user?.displayName?.split(' ')[0] || 'Innovator'}!</h1>
      <p>Let's continue your research journey. What will you discover today?</p>
    </div>
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
      <br>
      <form id="ideation-form">
        <input type="text" id="topic-input" name="topic" placeholder="e.g., 'chemistry simulations'" required />
        <button type="submit">Brainstorm Projects</button>
      </form>
    </div>
    <div class="recent-projects-list card" style="margin-top: 1.5rem;">
      <h2>Recent Projects</h2>
      ${state.recentProjects.length > 0 ? `
        <ul>
            ${state.recentProjects.map(p => `<li><a href="#" class="project-link" data-project-id="${p.id}">${p.title}</a></li>`).join('')}
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
    <div class="tool-content">
      ${renderActiveTool()}
    </div>
    `;
}

function renderActiveTool() {
    const { activeTool, toolInput, toolOutput, isToolLoading } = state;
    switch (activeTool) {
        case "abstract":
            return `
              <div class="tool-container">
                  <div class="tool-input-col">
                      <form id="abstract-form" class="card">
                          <h3>Paste Your Abstract</h3>
                          <textarea id="abstract-input" placeholder="Enter your project abstract here..." required>${toolInput.abstract || ''}</textarea>
                          <br>
                          <button type="submit">Optimize Abstract</button>
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
                          <input type="text" id="title-input" placeholder="Enter your current project title" value="${toolInput.title || ''}" required />
                          <br>
                          <h3>Project Description</h3>
                          <textarea id="title-desc-input" placeholder="Briefly describe your project..." required>${toolInput.description || ''}</textarea>
                          <br>
                          <button type="submit">Suggest Titles</button>
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
                          <textarea id="category-input" placeholder="Paste your abstract or a detailed project description..." required>${toolInput.abstract || ''}</textarea>
                          <br>
                          <button type="submit">Suggest Categories</button>
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
                      ${state.chatHistory.map(msg => `<div class="chat-message ${msg.role}">${marked.parse(msg.content)}</div>`).join("")}
                      ${state.isLoading ? `<div class="chat-message model"><div class="loader"></div></div>` : ""}
                  </div>
                  <form id="chat-form">
                      <input type="text" id="chat-input" placeholder="Type your answer..." required />
                      <button type="submit" aria-label="Send message">${ICON_SEND}</button>
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

    if (state.error) {
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
            <h3>${project.title}</h3>
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
    
    return `
        <div class="page-header project-header">
            <div>
                <span class="category-tag">${category}</span>
                <h1>${title}</h1>
                <p>${description}</p>
            </div>
            <button id="back-to-dash-btn">Back to Dashboard</button>
        </div>
        <div class="project-workspace-layout">
            <div class="project-main-col">
                <div class="card">
                    <h3>Project Scorecard</h3>
                    <div class="scores-container">
                        ${renderScoreBar('Impact', impact)}
                        ${renderScoreBar('Novelty', novelty)}
                        ${renderScoreBar('Rigor', rigor)}
                        ${renderScoreBar('Wow Factor', wowFactor)}
                    </div>
                </div>
                 <div class="card">
                    <h3>Field Analysis</h3>
                    <div class="content-area">${analysis}</div>
                </div>
                <div class="card">
                    <h3>Recommended Timeline & Next Steps</h3>
                    <div id="timeline-container" class="content-area">
                       ${state.timeline ? state.timeline : `<div class="loader-container"><div class="loader"></div><p>Generating your research plan...</p></div>`}
                    </div>
                </div>
                 <div class="card">
                    <h3>Initial Resources</h3>
                    <div class="resources-list content-area">
                      ${resourcesHtml}
                    </div>
                </div>
            </div>
            <aside class="project-sidebar-col">
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
                        <input type="text" id="chat-input" placeholder="Ask your coach..." required />
                        <button type="submit" aria-label="Send message">${ICON_SEND}</button>
                    </form>
                </div>
            </aside>
        </div>
    `;
}


// --- EVENT HANDLERS & LOGIC ---

function addSidebarEventListeners() {
    document.getElementById("signout-btn")?.addEventListener("click", handleSignOut);
    document.querySelectorAll(".nav-btn").forEach(button => {
        button.addEventListener("click", (e) => {
            const view = (e.currentTarget as HTMLElement).dataset.view as View;
            setState({ view, toolOutput: "", toolInput: {}, error: null });
        });
    });
}

function addEventListenersForView() {
    switch (state.view) {
        case "dashboard":
            document.getElementById("ideation-form")?.addEventListener("submit", handleIdeationSubmit);
            break;
        case "results":
             document.getElementById("back-to-dash-btn")?.addEventListener("click", () => {
                setState({ view: "dashboard", error: null });
            });
            document.querySelectorAll(".select-project-btn").forEach(button => {
                button.addEventListener("click", handleSelectProject);
            });
            break;
        case "tools":
            document.querySelectorAll(".tab-btn").forEach(button => {
                button.addEventListener("click", (e) => {
                    const tool = (e.currentTarget as HTMLElement).dataset.tool as AiTool;
                    setState({ activeTool: tool, toolOutput: "", toolInput: {} });
                });
            });
            const toolForm = document.querySelector("#abstract-form, #title-form, #category-form, #chat-form");
            toolForm?.addEventListener("submit", handleToolSubmit);
            if(state.activeTool === 'judge' && state.chatHistory.length === 0){
                // Initialize judge chat
                const judgeChat = ai.chats.create({
                    model: "gemini-2.5-flash",
                    config: {
                        systemInstruction: `You are an AI Mock Science Fair Judge. Your persona is that of a knowledgeable, rigorous, and slightly intimidating judge at a prestigious international science fair. Your goal is to critically evaluate the student's project by asking probing questions. Start the conversation by asking for a brief summary of their project. Ask one question at a time. Your questions should challenge the student on their methodology, data analysis, conclusions, and understanding of the project's limitations and future directions. Keep your responses concise and to the point. Do not provide answers or overly praise the student. Your role is to question and probe for depth of understanding.`
                    }
                });
                setState({ chat: judgeChat, chatHistory: [{role: 'model', content: "Hello. I will be your judge today. Please begin by summarizing your project's purpose and primary findings in two or three sentences."}] });
            }
            break;
        case "project":
            document.getElementById("back-to-dash-btn")?.addEventListener("click", () => {
                // Clear out project-specific state when leaving
                setState({ view: "dashboard", selectedProject: null, timeline: null, chat: null, chatHistory: [], error: null });
            });
            document.getElementById("chat-form")?.addEventListener("submit", handleCoachChatSubmit);
            
            // Initialize chat and timeline if this is the first render of this view for this project
            if (!state.chat) {
                initializeProjectWorkspace();
            }
            break;
    }
}

async function handleIdeationSubmit(event: Event) {
    event.preventDefault();
    const topicInput = document.getElementById("topic-input") as HTMLInputElement;
    const topic = topicInput.value;
    if (!topic) return;

    setState({
        view: "results",
        isLoading: true,
        topic,
        generatedProjects: [],
        fieldAnalysis: "",
        sources: [],
        error: null,
    });

    try {
        // --- Call 1: Field Analysis with Google Search ---
        const analysisPrompt = `You are a senior research scientist and grant reviewer. Your task is to provide a brief, insightful analysis of the research field: "${topic}".

1.  **Field Overview:** Briefly summarize the current state of this field, its key challenges, and recent breakthroughs. Keep this to 2-3 paragraphs.
2.  **Emerging Sub-Topics:** Identify 3-5 promising and specific sub-topics or niche areas that are ripe for novel research by a high school or undergraduate student. These should be cutting-edge but accessible.

Present your response clearly. Use markdown for formatting.`;

        const analysisResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: analysisPrompt,
            config: {
                tools: [{googleSearch: {}}],
            },
        });
        
        const fieldAnalysisText = analysisResponse.text;
        const groundingMetadata = analysisResponse.candidates?.[0]?.groundingMetadata;
        const webSources = groundingMetadata?.groundingChunks?.filter(c => c.web).map(c => c.web) || [];
        const uniqueSources: { uri: string; title: string }[] = [];
        const seenUris = new Set<string>();
        webSources.forEach(source => {
            if (source && source.uri && !seenUris.has(source.uri)) {
                uniqueSources.push({ uri: source.uri, title: source.title || source.uri });
                seenUris.add(source.uri);
            }
        });

        // Update state with analysis so user sees something while projects generate
        setState({ fieldAnalysis: await marked.parse(fieldAnalysisText), sources: uniqueSources });
        
        // --- Call 2: Generate Projects with JSON Schema ---
        const projectPrompt = `You are an AI research assistant specializing in ideating high-impact science fair projects. Based on the following analysis of the field of "${topic}", generate 5 innovative and feasible project ideas suitable for a high school or undergraduate student.

Field Analysis:
---
${fieldAnalysisText}
---

For each project idea, provide the following information in a JSON object. Return a JSON array of these objects.`;

        const schema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "A catchy and descriptive project title." },
                description: { type: Type.STRING, description: "A 2-3 sentence summary of the project's goal and methodology." },
                category: { type: Type.STRING, description: "The most relevant science fair category (e.g., 'Biochemistry')." },
                impact: { type: Type.NUMBER, description: "Score from 1-10 on potential real-world impact." },
                rigor: { type: Type.NUMBER, description: "Score from 1-10 on scientific rigor." },
                novelty: { type: Type.NUMBER, description: "Score from 1-10 on how new the idea is." },
                wowFactor: { type: Type.NUMBER, description: "Score from 1-10 on its potential to impress judges." },
                resourcesHtml: { type: Type.STRING, description: "A bulleted list in HTML format (<ul><li>...</li></ul>) of 2-3 key resources a student could start with." },
              },
              required: ["title", "description", "category", "impact", "rigor", "novelty", "wowFactor", "resourcesHtml"],
            },
        };

        const projectResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: projectPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema
            }
        });
        
        const generatedProjects = JSON.parse(projectResponse.text);
        setState({ isLoading: false, generatedProjects });

    } catch(err) {
        console.error("Ideation Error:", err);
        setState({ isLoading: false, error: `Failed to generate ideas: ${(err as Error).message}` });
    }
}

async function handleSelectProject(event: Event) {
    const button = event.currentTarget as HTMLButtonElement;
    const projectIndex = parseInt(button.dataset.projectIndex!);
    const selectedProject = state.generatedProjects[projectIndex];
    if (!selectedProject || !state.user) return;

    // Use the main isLoading flag for the screen transition
    setState({ isLoading: true, view: "project" });

    try {
        // Combine the AI-generated project details with the overall field analysis
        const projectData: ProjectIdea = {
            ...selectedProject,
            analysis: state.fieldAnalysis, // This is the fix
            createdAt: new Date()
        };
        // Remove id if it exists from generation to avoid Firestore errors
        delete projectData.id; 
        
        const docRef = await addDoc(collection(db, "users", state.user.uid, "projects"), projectData);
        
        const finalProject = { ...projectData, id: docRef.id };

        // Transition to project view, which will have its own loaders
        setState({
            selectedProject: finalProject,
            isLoading: false,
            chat: null, 
            chatHistory: [],
            timeline: null
        });
    } catch (error) {
        console.error("Error saving project:", error);
        // If saving fails, go back to the results view and show an error
        setState({ 
            view: "results",
            isLoading: false, 
            error: `Could not save the project. Please try again. ${(error as Error).message}` 
        });
    }
}

async function initializeProjectWorkspace() {
    if (!state.selectedProject) return;

    // 1. Initialize AI Coach Chat
    const coachChat = ai.chats.create({
        model: "gemini-2.5-flash",
        config: {
            systemInstruction: `You are an encouraging and knowledgeable AI Research Coach for a student. Your goal is to guide them through their science project from ideation to completion. Be supportive, ask clarifying questions, help them break down complex tasks, and suggest resources. Never give them the answers directly. Instead, empower them to find the answers themselves. Start the conversation by congratulating them on choosing a project and asking them what their first thought or question is about it.`
        }
    });

    try {
        // Send a priming message to get the conversation started by the model
        const initialResponse = await coachChat.sendMessage({ message: "Hello, please provide your opening message to the student." });

        setState({
            chat: coachChat,
            chatHistory: [{ role: 'model', content: initialResponse.text }]
        });
    } catch (err) {
        console.error("Error initializing coach chat", err);
        setState({
            chat: coachChat, // Still set the chat object
            chatHistory: [{ role: 'model', content: "Hello! I'm your AI Research coach. I had a little trouble starting up, but I'm ready to help now. What's on your mind?" }]
        });
    }

    // 2. Generate Project Timeline in the background
    generateProjectTimeline();
}

async function generateProjectTimeline() {
    if (!state.selectedProject) return;

    const { title, description } = state.selectedProject;
    const prompt = `You are a project manager for a research institute. Create a detailed, actionable, step-by-step timeline for a student to complete the following research project.

Project Title: "${title}"
Project Description: "${description}"

The timeline should be broken down into logical phases (e.g., Phase 1: Background Research, Phase 2: Experimentation). Each phase should have a list of specific, actionable tasks. Format the entire output as a single block of HTML using <h3> for phases and <ul>/<li> for tasks. Do not include any other text or markdown characters like \`\`\`html.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
        });
        setState({ timeline: response.text });
    } catch (error) {
        console.error("Timeline Generation Error:", error);
        setState({ timeline: `<div class="error-message">Could not generate a timeline. Please try reloading or asking your coach for help.</div>` });
    }
}


async function handleCoachChatSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.querySelector("#chat-input") as HTMLInputElement;
    const message = input.value;
    if (!message || !state.chat) return;
    
    const currentUserHistory: ChatMessage[] = [...state.chatHistory, { role: "user", content: message }];
    input.value = "";
    
    setState({
        isLoading: true,
        chatHistory: currentUserHistory,
    });

    try {
        const response = await state.chat.sendMessage({ message });
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
    if(state.activeTool === 'judge'){
        handleJudgeChatSubmit(event);
        return;
    }

    setState({ isToolLoading: true, toolOutput: "" });
    let prompt = "";
    let input = {};

    try {
        switch (state.activeTool) {
            case "abstract":
                const abstract = (document.getElementById("abstract-input") as HTMLTextAreaElement).value;
                input = { abstract };
                prompt = `You are an expert academic editor. Your task is to revise the following science fair project abstract.\n- Ensure it is concise, clear, and impactful.\n- Correct any grammatical errors or awkward phrasing.\n- Structure it logically: Introduction/Purpose, Methods, Results, Conclusion.\n- The total length should not exceed 250 words.\n- Return ONLY the revised abstract as a single block of text.\n\nOriginal Abstract:\n---\n${abstract}\n---`;
                break;
            case "title":
                const title = (document.getElementById("title-input") as HTMLInputElement).value;
                const description = (document.getElementById("title-desc-input") as HTMLTextAreaElement).value;
                input = { title, description };
                prompt = `You are a creative branding expert specializing in scientific communication. Based on the following project title and description, generate a list of 5 alternative titles. The titles should be catchy, informative, and professional.\n\nOriginal Title: ${title}\nProject Description: ${description}\n\nReturn the list in markdown format.`;
                break;
            case "category":
                const catAbstract = (document.getElementById("category-input") as HTMLTextAreaElement).value;
                input = { abstract: catAbstract };
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

        const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
        const output = state.activeTool === 'abstract' ? response.text : await marked.parse(response.text);
        setState({ isToolLoading: false, toolOutput: output, toolInput: input });
    } catch (err) {
        console.error(err);
        setState({ isToolLoading: false, toolOutput: `<div class="error-message">Error: ${(err as Error).message}</div>` });
    }
}

async function handleJudgeChatSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.querySelector("#chat-input") as HTMLInputElement;
    const message = input.value;
    if (!message || !state.chat) return;
    
    const currentUserHistory: ChatMessage[] = [...state.chatHistory, { role: "user", content: message }];
    input.value = "";

    setState({
        isLoading: true,
        chatHistory: currentUserHistory,
    });

    try {
        const response = await state.chat.sendMessage({ message });
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


// --- INITIALIZATION ---
function startApp() {
  resetState();
  
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      setState({ authStatus: "signedIn", user, view: 'dashboard' });
      await fetchDashboardData(user.uid);
    } else {
      resetState();
      setState({ authStatus: "signedOut" });
    }
  });
}

startApp();