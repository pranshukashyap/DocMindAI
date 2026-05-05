import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";

// ─── Google Fonts injected at runtime ───────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href =
  "https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap";
document.head.appendChild(fontLink);

const API = "http://127.0.0.1:8000";

// ─── Markdown-like renderer (bold, bullets, numbered) ────────
function renderMarkdown(text) {
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Bullet point
    if (/^[-•*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-•*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-•*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={i} style={{ margin: "8px 0 8px 16px", padding: 0, listStyle: "none" }}>
          {items.map((item, j) => (
            <li key={j} style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "flex-start" }}>
              <span style={{ color: "var(--accent-teal)", marginTop: 2, flexShrink: 0 }}>◆</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={i} style={{ margin: "8px 0 8px 16px", padding: 0, listStyle: "none", counterReset: "item" }}>
          {items.map((item, j) => (
            <li key={j} style={{ display: "flex", gap: 10, marginBottom: 4, alignItems: "flex-start" }}>
              <span style={{
                color: "var(--accent-violet)", fontWeight: 600,
                minWidth: 20, flexShrink: 0, fontFamily: "Syne, sans-serif"
              }}>{j + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Heading (## or #)
    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^(#+)/)[1].length;
      const content = line.replace(/^#+\s+/, "");
      elements.push(
        <div key={i} style={{
          fontFamily: "Syne, sans-serif",
          fontWeight: 700,
          fontSize: level === 1 ? "1.15em" : level === 2 ? "1.05em" : "1em",
          color: "var(--text-primary)",
          margin: "14px 0 6px",
          borderBottom: level <= 2 ? "1px solid var(--glass-border)" : "none",
          paddingBottom: level <= 2 ? 4 : 0,
        }}>{renderInline(content)}</div>
      );
      i++;
      continue;
    }

    // Normal paragraph
    elements.push(
      <p key={i} style={{ margin: "4px 0 8px", lineHeight: 1.7 }}>
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return elements;
}

function renderInline(text) {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i} style={{ color: "var(--accent-teal)", fontWeight: 600 }}>
        {part.slice(2, -2)}
      </strong>;
    }
    return part;
  });
}

// ─── Typing indicator ────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "4px 0" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: "50%",
          background: "var(--accent-teal)",
          animation: `bounce 1.2s ${i * 0.2}s infinite ease-in-out`,
        }} />
      ))}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────
export default function App() {
  const [chats, setChats] = useState([]); // [{id, sessionId, title, messages, docs}]
  const [activeChatIndex, setActiveChatIndex] = useState(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const activeChat = activeChatIndex !== null ? chats[activeChatIndex] : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + "px";
    }
  }, [question]);

  // ── Create new chat session ──────────────────────────────
  const createNewChat = async () => {
    try {
      const res = await axios.post(`${API}/session/new`);
      const sessionId = res.data.session_id;
      const newChat = {
        id: Date.now(),
        sessionId,
        title: "New Chat",
        messages: [],
        docs: [],
      };
      setChats(prev => [newChat, ...prev]);
      setActiveChatIndex(0);
    } catch {
      alert("Could not connect to backend. Is the server running?");
    }
  };

  // ── Upload files ─────────────────────────────────────────
  const handleUpload = useCallback(async (fileList) => {
    if (!activeChat) return alert("Start a new chat first.");
    const files = Array.from(fileList).filter(f =>
      f.name.endsWith(".pdf") || f.name.endsWith(".docx")
    );
    if (!files.length) return alert("Only PDF and DOCX files are supported.");

    setUploading(true);
    const formData = new FormData();
    formData.append("session_id", activeChat.sessionId);
    files.forEach(f => formData.append("files", f));

    try {
      const res = await axios.post(`${API}/upload`, formData);
      const uploadedNames = res.data.files;
      setChats(prev => prev.map((c, i) =>
        i === activeChatIndex
          ? { ...c, docs: [...c.docs, ...uploadedNames] }
          : c
      ));
    } catch {
      alert("Upload failed. Check backend.");
    }
    setUploading(false);
  }, [activeChat, activeChatIndex]);

  // ── Ask question ─────────────────────────────────────────
  const askQuestion = async () => {
    const q = question.trim();
    if (!q || !activeChat || loading) return;

    // Set chat title from first question
    const isFirstMessage = activeChat.messages.length === 0;
    const title = isFirstMessage
      ? (q.length > 45 ? q.slice(0, 45) + "…" : q)
      : activeChat.title;

    const userMsg = { role: "user", content: q };

    setChats(prev => prev.map((c, i) =>
      i === activeChatIndex
        ? { ...c, title, messages: [...c.messages, userMsg] }
        : c
    ));
    setQuestion("");
    setLoading(true);

    try {
      const res = await axios.post(`${API}/ask`, {
        session_id: activeChat.sessionId,
        question: q,
      });
      const aiMsg = { role: "assistant", content: res.data.answer };
      setChats(prev => prev.map((c, i) =>
        i === activeChatIndex
          ? { ...c, messages: [...c.messages, aiMsg] }
          : c
      ));
    } catch {
      const errMsg = { role: "assistant", content: "⚠️ Failed to get a response. Please check the backend." };
      setChats(prev => prev.map((c, i) =>
        i === activeChatIndex ? { ...c, messages: [...c.messages, errMsg] } : c
      ));
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  const switchChat = (index) => {
    setActiveChatIndex(index);
    setQuestion("");
  };

  const deleteChat = async (e, index) => {
    e.stopPropagation();
    const chat = chats[index];
    try { await axios.delete(`${API}/session/${chat.sessionId}`); } catch {}
    setChats(prev => prev.filter((_, i) => i !== index));
    if (activeChatIndex === index) setActiveChatIndex(null);
    else if (activeChatIndex > index) setActiveChatIndex(prev => prev - 1);
  };

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg-deep:        #060b14;
          --bg-mid:         #0a1020;
          --glass-bg:       rgba(255,255,255,0.04);
          --glass-bg-hover: rgba(255,255,255,0.07);
          --glass-border:   rgba(255,255,255,0.09);
          --glass-strong:   rgba(255,255,255,0.06);
          --text-primary:   #eef2ff;
          --text-secondary: #8b9ec7;
          --text-muted:     #4a5878;
          --accent-teal:    #2dd4bf;
          --accent-violet:  #a78bfa;
          --accent-rose:    #fb7185;
          --accent-amber:   #fbbf24;
          --user-bubble:    rgba(45,212,191,0.12);
          --ai-bubble:      rgba(167,139,250,0.07);
          --scrollbar:      rgba(255,255,255,0.06);
        }
        html, body, #root { height: 100%; font-family: 'DM Sans', sans-serif; background: var(--bg-deep); color: var(--text-primary); overflow: hidden; }

        /* Aurora blobs */
        .aurora-bg {
          position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 0;
        }
        .blob {
          position: absolute; border-radius: 50%; filter: blur(100px); opacity: 0.18;
          animation: drift 18s ease-in-out infinite alternate;
        }
        .blob-1 { width: 600px; height: 600px; background: #0d9488; top: -200px; left: -150px; animation-duration: 20s; }
        .blob-2 { width: 500px; height: 500px; background: #7c3aed; top: 30%; right: -100px; animation-duration: 25s; animation-delay: -8s; }
        .blob-3 { width: 400px; height: 400px; background: #be185d; bottom: -150px; left: 35%; animation-duration: 22s; animation-delay: -4s; }
        .blob-4 { width: 350px; height: 350px; background: #0284c7; bottom: 10%; left: -80px; animation-duration: 28s; animation-delay: -12s; }

        @keyframes drift {
          0%   { transform: translate(0,0) scale(1); }
          33%  { transform: translate(40px,-30px) scale(1.05); }
          66%  { transform: translate(-20px,50px) scale(0.95); }
          100% { transform: translate(30px,20px) scale(1.02); }
        }

        /* Grain overlay */
        .grain {
          position: fixed; inset: 0; pointer-events: none; z-index: 1; opacity: 0.03;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          background-size: 200px;
        }

        /* Layout */
        .layout { display: flex; height: 100vh; position: relative; z-index: 2; }

        /* Sidebar */
        .sidebar {
          width: 270px; min-width: 270px;
          background: rgba(6,11,20,0.7);
          border-right: 1px solid var(--glass-border);
          backdrop-filter: blur(24px);
          display: flex; flex-direction: column;
          transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
          z-index: 10;
        }
        .sidebar.collapsed { transform: translateX(-270px); min-width: 0; width: 0; overflow: hidden; }

        .sidebar-header {
          padding: 20px 16px 12px;
          border-bottom: 1px solid var(--glass-border);
          display: flex; align-items: center; gap: 10px;
        }
        .logo-mark {
          width: 32px; height: 32px; border-radius: 10px;
          background: linear-gradient(135deg, var(--accent-teal), var(--accent-violet));
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0;
        }
        .logo-text {
          font-family: 'Syne', sans-serif; font-weight: 800;
          font-size: 1rem; letter-spacing: -0.02em;
          background: linear-gradient(90deg, var(--accent-teal), var(--accent-violet));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }

        .new-chat-btn {
          margin: 12px 12px 8px;
          padding: 10px 14px;
          background: linear-gradient(135deg, rgba(45,212,191,0.15), rgba(167,139,250,0.15));
          border: 1px solid rgba(45,212,191,0.25);
          border-radius: 12px; cursor: pointer;
          color: var(--accent-teal); font-family: 'Syne', sans-serif;
          font-weight: 600; font-size: 0.82rem; letter-spacing: 0.04em;
          text-transform: uppercase;
          display: flex; align-items: center; gap: 8px;
          transition: all 0.2s; backdrop-filter: blur(8px);
        }
        .new-chat-btn:hover {
          background: linear-gradient(135deg, rgba(45,212,191,0.22), rgba(167,139,250,0.22));
          border-color: rgba(45,212,191,0.5);
          transform: translateY(-1px);
        }

        .chat-list { flex: 1; overflow-y: auto; padding: 4px 8px 12px; }
        .chat-list::-webkit-scrollbar { width: 4px; }
        .chat-list::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 4px; }

        .chat-item {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 10px;
          border-radius: 10px; cursor: pointer;
          transition: background 0.15s;
          group: true;
          margin-bottom: 2px;
        }
        .chat-item:hover { background: var(--glass-bg-hover); }
        .chat-item.active { background: rgba(45,212,191,0.08); border: 1px solid rgba(45,212,191,0.15); }
        .chat-item-icon { font-size: 13px; flex-shrink: 0; opacity: 0.6; }
        .chat-item-title {
          flex: 1; font-size: 0.82rem; color: var(--text-secondary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          line-height: 1.4;
        }
        .chat-item.active .chat-item-title { color: var(--accent-teal); }
        .chat-delete {
          opacity: 0; padding: 2px 5px; border-radius: 5px;
          background: rgba(251,113,133,0.15); border: none; cursor: pointer;
          color: var(--accent-rose); font-size: 11px;
          transition: opacity 0.15s;
          flex-shrink: 0;
        }
        .chat-item:hover .chat-delete { opacity: 1; }

        .sidebar-section-label {
          padding: 8px 10px 4px;
          font-size: 0.68rem; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--text-muted);
          font-family: 'Syne', sans-serif;
        }

        /* Main area */
        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

        /* Topbar */
        .topbar {
          height: 56px; min-height: 56px;
          background: rgba(6,11,20,0.6);
          border-bottom: 1px solid var(--glass-border);
          backdrop-filter: blur(24px);
          display: flex; align-items: center; gap: 12px; padding: 0 20px;
        }
        .toggle-btn {
          width: 32px; height: 32px; border-radius: 8px;
          background: var(--glass-bg); border: 1px solid var(--glass-border);
          cursor: pointer; color: var(--text-secondary); font-size: 14px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s; flex-shrink: 0;
        }
        .toggle-btn:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
        .topbar-title {
          font-family: 'Syne', sans-serif; font-weight: 600; font-size: 0.9rem;
          color: var(--text-secondary); flex: 1;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .topbar-title span { color: var(--text-primary); }
        .docs-pill {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: 20px;
          background: rgba(45,212,191,0.1); border: 1px solid rgba(45,212,191,0.2);
          font-size: 0.75rem; color: var(--accent-teal); font-weight: 500;
          white-space: nowrap;
        }

        /* Messages */
        .messages-area {
          flex: 1; overflow-y: auto; padding: 28px 0;
          scroll-behavior: smooth;
        }
        .messages-area::-webkit-scrollbar { width: 5px; }
        .messages-area::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 4px; }

        .messages-inner { max-width: 760px; margin: 0 auto; padding: 0 20px; }

        .empty-state {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; height: 100%; min-height: 400px; gap: 16px;
          color: var(--text-muted); text-align: center;
        }
        .empty-icon {
          width: 72px; height: 72px; border-radius: 20px;
          background: linear-gradient(135deg, rgba(45,212,191,0.1), rgba(167,139,250,0.1));
          border: 1px solid var(--glass-border);
          display: flex; align-items: center; justify-content: center;
          font-size: 32px;
        }
        .empty-title {
          font-family: 'Syne', sans-serif; font-weight: 700; font-size: 1.2rem;
          color: var(--text-secondary);
        }
        .empty-sub { font-size: 0.85rem; max-width: 300px; line-height: 1.6; }

        /* Message bubbles */
        .message-row { display: flex; gap: 12px; margin-bottom: 20px; align-items: flex-start; }
        .message-row.user { flex-direction: row-reverse; }

        .avatar {
          width: 32px; height: 32px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; flex-shrink: 0; margin-top: 2px;
        }
        .avatar.user {
          background: linear-gradient(135deg, var(--accent-teal), #0891b2);
        }
        .avatar.ai {
          background: linear-gradient(135deg, var(--accent-violet), #6d28d9);
        }

        .bubble {
          max-width: 80%; padding: 14px 18px; border-radius: 16px;
          line-height: 1.65; font-size: 0.88rem;
          backdrop-filter: blur(16px);
          border: 1px solid var(--glass-border);
          animation: popIn 0.2s ease-out;
        }
        .bubble.user {
          background: var(--user-bubble);
          border-color: rgba(45,212,191,0.2);
          border-bottom-right-radius: 4px;
          color: var(--text-primary);
        }
        .bubble.ai {
          background: var(--ai-bubble);
          border-color: rgba(167,139,250,0.15);
          border-bottom-left-radius: 4px;
          color: var(--text-primary);
        }

        @keyframes popIn {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Typing bubble */
        .typing-bubble {
          padding: 12px 18px; border-radius: 16px; border-bottom-left-radius: 4px;
          background: var(--ai-bubble); border: 1px solid rgba(167,139,250,0.15);
          backdrop-filter: blur(16px); display: inline-block;
        }

        /* Input area */
        .input-area {
          padding: 16px 20px 20px;
          background: rgba(6,11,20,0.6);
          border-top: 1px solid var(--glass-border);
          backdrop-filter: blur(24px);
        }
        .input-inner { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }

        /* Upload zone */
        .upload-zone {
          border: 1.5px dashed var(--glass-border);
          border-radius: 12px; padding: 10px 14px;
          display: flex; align-items: center; gap: 10px;
          cursor: pointer; transition: all 0.2s;
          background: var(--glass-bg);
        }
        .upload-zone:hover, .upload-zone.drag { border-color: var(--accent-teal); background: rgba(45,212,191,0.05); }
        .upload-zone-text { font-size: 0.78rem; color: var(--text-muted); flex: 1; }
        .upload-zone-text strong { color: var(--accent-teal); font-weight: 500; }
        .upload-zone-btn {
          padding: 5px 12px; border-radius: 8px; font-size: 0.75rem;
          background: rgba(45,212,191,0.12); border: 1px solid rgba(45,212,191,0.25);
          color: var(--accent-teal); cursor: pointer; font-weight: 500;
          transition: all 0.15s; white-space: nowrap; font-family: 'DM Sans', sans-serif;
        }
        .upload-zone-btn:hover { background: rgba(45,212,191,0.2); }

        .doc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .doc-chip {
          display: flex; align-items: center; gap: 5px;
          padding: 3px 9px; border-radius: 20px; font-size: 0.73rem;
          background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.2);
          color: var(--accent-violet);
        }

        /* Chat input row */
        .chat-input-row { display: flex; gap: 10px; align-items: flex-end; }
        .chat-textarea {
          flex: 1; padding: 12px 16px;
          background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border);
          border-radius: 14px; color: var(--text-primary);
          font-family: 'DM Sans', sans-serif; font-size: 0.88rem;
          resize: none; outline: none; line-height: 1.5;
          transition: border-color 0.2s; min-height: 48px; max-height: 140px;
          backdrop-filter: blur(8px);
        }
        .chat-textarea::placeholder { color: var(--text-muted); }
        .chat-textarea:focus { border-color: rgba(45,212,191,0.4); }

        .send-btn {
          width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, var(--accent-teal), #0891b2);
          border: none; cursor: pointer; color: white;
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; transition: all 0.2s;
          box-shadow: 0 4px 16px rgba(45,212,191,0.25);
        }
        .send-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(45,212,191,0.35); }
        .send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

        .hint-text {
          font-size: 0.7rem; color: var(--text-muted); text-align: center; margin-top: 4px;
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-5px); }
        }

        /* Welcome screen */
        .welcome {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; height: 100%;
          gap: 20px; padding: 40px; text-align: center;
        }
        .welcome-logo {
          width: 80px; height: 80px; border-radius: 24px;
          background: linear-gradient(135deg, rgba(45,212,191,0.15), rgba(167,139,250,0.15));
          border: 1px solid rgba(255,255,255,0.1);
          display: flex; align-items: center; justify-content: center;
          font-size: 38px;
          box-shadow: 0 0 60px rgba(45,212,191,0.1), 0 0 120px rgba(167,139,250,0.08);
        }
        .welcome-title {
          font-family: 'Syne', sans-serif; font-weight: 800; font-size: 2rem;
          background: linear-gradient(135deg, var(--accent-teal), var(--accent-violet));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          letter-spacing: -0.02em;
        }
        .welcome-sub { color: var(--text-secondary); font-size: 0.95rem; max-width: 380px; line-height: 1.7; }
        .welcome-cta {
          padding: 12px 28px; border-radius: 14px; cursor: pointer;
          background: linear-gradient(135deg, rgba(45,212,191,0.15), rgba(167,139,250,0.15));
          border: 1px solid rgba(45,212,191,0.3);
          color: var(--accent-teal); font-family: 'Syne', sans-serif;
          font-weight: 700; font-size: 0.9rem; letter-spacing: 0.03em;
          transition: all 0.2s;
        }
        .welcome-cta:hover {
          background: linear-gradient(135deg, rgba(45,212,191,0.22), rgba(167,139,250,0.22));
          transform: translateY(-2px);
        }
      `}</style>

      {/* Aurora background */}
      <div className="aurora-bg">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
        <div className="blob blob-4" />
      </div>
      <div className="grain" />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx"
        style={{ display: "none" }}
        onChange={e => handleUpload(e.target.files)}
      />

      <div className="layout">
        {/* ── Sidebar ── */}
        <div className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
          <div className="sidebar-header">
            <div className="logo-mark">✦</div>
            <div className="logo-text">DocMind AI</div>
          </div>

          <button className="new-chat-btn" onClick={createNewChat}>
            <span>＋</span> New Chat
          </button>

          <div className="chat-list">
            {chats.length > 0 && (
              <div className="sidebar-section-label">Recent</div>
            )}
            {chats.map((chat, i) => (
              <div
                key={chat.id}
                className={`chat-item ${activeChatIndex === i ? "active" : ""}`}
                onClick={() => switchChat(i)}
              >
                <span className="chat-item-icon">💬</span>
                <span className="chat-item-title">{chat.title}</span>
                <button className="chat-delete" onClick={e => deleteChat(e, i)}>✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main ── */}
        <div className="main">
          {/* Topbar */}
          <div className="topbar">
            <button className="toggle-btn" onClick={() => setSidebarOpen(v => !v)}>
              {sidebarOpen ? "◀" : "▶"}
            </button>
            <div className="topbar-title">
              {activeChat
                ? <><span>{activeChat.title}</span></>
                : "DocMind AI"
              }
            </div>
            {activeChat?.docs?.length > 0 && (
              <div className="docs-pill">
                📄 {activeChat.docs.length} doc{activeChat.docs.length > 1 ? "s" : ""}
              </div>
            )}
          </div>

          {/* Content */}
          {!activeChat ? (
            /* Welcome screen */
            <div className="welcome">
              <div className="welcome-logo">✦</div>
              <div className="welcome-title">DocMind AI</div>
              <div className="welcome-sub">
                Upload your PDFs & DOCX files and have intelligent, structured conversations powered by Phi-3 running locally on Ollama.
              </div>
              <button className="welcome-cta" onClick={createNewChat}>
                Start a New Chat →
              </button>
            </div>
          ) : (
            <>
              {/* Messages */}
              <div className="messages-area">
                <div className="messages-inner">
                  {activeChat.messages.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">📂</div>
                      <div className="empty-title">Upload your documents</div>
                      <div className="empty-sub">
                        Drop a PDF or DOCX below, then ask anything about its contents.
                      </div>
                    </div>
                  ) : (
                    activeChat.messages.map((msg, i) => (
                      <div key={i} className={`message-row ${msg.role}`}>
                        <div className={`avatar ${msg.role === "user" ? "user" : "ai"}`}>
                          {msg.role === "user" ? "👤" : "✦"}
                        </div>
                        <div className={`bubble ${msg.role === "user" ? "user" : "ai"}`}>
                          {msg.role === "user"
                            ? msg.content
                            : renderMarkdown(msg.content)
                          }
                        </div>
                      </div>
                    ))
                  )}
                  {loading && (
                    <div className="message-row">
                      <div className="avatar ai">✦</div>
                      <div className="typing-bubble"><TypingDots /></div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input area */}
              <div className="input-area">
                <div className="input-inner">
                  {/* Upload zone */}
                  <div
                    className={`upload-zone ${dragOver ? "drag" : ""}`}
                    onClick={() => fileInputRef.current.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                  >
                    <span style={{ fontSize: 18 }}>📎</span>
                    <div className="upload-zone-text">
                      {uploading
                        ? "⏳ Uploading…"
                        : activeChat.docs.length === 0
                          ? <><strong>Drop files here</strong> or click to browse — PDF & DOCX supported</>
                          : <div className="doc-chips">
                              {activeChat.docs.map((d, i) => (
                                <span key={i} className="doc-chip">📄 {d}</span>
                              ))}
                            </div>
                      }
                    </div>
                    {!uploading && (
                      <button className="upload-zone-btn" onClick={e => { e.stopPropagation(); fileInputRef.current.click(); }}>
                        + Add Files
                      </button>
                    )}
                  </div>

                  {/* Chat input */}
                  <div className="chat-input-row">
                    <textarea
                      ref={textareaRef}
                      className="chat-textarea"
                      value={question}
                      onChange={e => setQuestion(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask anything from your documents…"
                      rows={1}
                    />
                    <button
                      className="send-btn"
                      onClick={askQuestion}
                      disabled={!question.trim() || loading}
                      title="Send (Enter)"
                    >
                      ➤
                    </button>
                  </div>
                  <div className="hint-text">Enter to send · Shift+Enter for new line · Phi-3 via Ollama</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}