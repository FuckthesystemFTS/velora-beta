(function initChatWidget() {
  const widget = document.querySelector("[data-chat-widget]");
  if (!widget) {
    return;
  }

  const storageKey = "happymeter-chat-open";
  const toggle = widget.querySelector("[data-chat-toggle]");
  const minimize = widget.querySelector("[data-chat-minimize]");
  const messagesNode = widget.querySelector("[data-chat-messages]");
  const statusNode = widget.querySelector("[data-chat-status]");
  const form = widget.querySelector("[data-chat-form]");
  const textarea = form?.querySelector("textarea");
  const sendButton = form?.querySelector('button[type="submit"]');
  const loginUrl = widget.dataset.loginUrl || "/login?redirect=/community";
  const isAuthenticated = widget.dataset.authenticated === "1";

  function openAuthPrompt(message) {
    if (window.HappyMeterAuthModal && typeof window.HappyMeterAuthModal.open === "function") {
      window.HappyMeterAuthModal.open({
        title: widget.dataset.authTitle || widget.dataset.loginLabel,
        body: message || widget.dataset.loginMessage,
        redirectTo: widget.dataset.redirectTo || "/app?chat=open"
      });
      setOpenState(true);
      return;
    }
    window.location.assign(loginUrl);
  }

  function setOpenState(isOpen) {
    widget.classList.toggle("is-open", isOpen);
    try {
      window.localStorage.setItem(storageKey, isOpen ? "1" : "0");
    } catch (error) {
      void error;
    }
  }

  function getOpenState() {
    const query = new URL(window.location.href).searchParams.get("chat");
    if (query === "open") {
      return true;
    }
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch (error) {
      return false;
    }
  }

  function formatDate(input) {
    const value = new Date(input);
    if (Number.isNaN(value.getTime())) {
      return "";
    }
    return value.toLocaleString();
  }

  function setStatus(text) {
    statusNode.textContent = text;
  }

  function renderMessages(messages) {
    if (!messages.length) {
      messagesNode.innerHTML = `<div class="chat-widget__message"><p>${widget.dataset.emptyMessage}</p></div>`;
      return;
    }

    messagesNode.innerHTML = messages
      .map((message) => {
        const action = isAuthenticated
          ? `<button type="button" class="chat-widget__like" data-chat-like="${message.id}">
               ${widget.dataset.likeLabel} ${message.likesCount}
             </button>`
          : `<button type="button" class="chat-widget__like" data-chat-auth-like="1">${widget.dataset.loginLabel}</button>`;

        return `<article class="chat-widget__message">
            <div class="chat-widget__message-meta">
              <strong>${escapeHtml(message.authorName)}</strong>
              <small>${escapeHtml(formatDate(message.createdAt))}</small>
            </div>
            <p>${escapeHtml(message.content)}</p>
            <div class="chat-widget__message-actions">
              <small>${String(message.language || "").toUpperCase()}</small>
              ${action}
            </div>
          </article>`;
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function loadMessages() {
    try {
      const response = await fetch("/api/chat/messages", {
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error("chat-load-failed");
      }
      renderMessages(payload.messages || []);
      setStatus(payload.canPost ? widget.dataset.subtitle : widget.dataset.loginMessage);
    } catch (error) {
      setStatus(widget.dataset.errorLabel);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!isAuthenticated) {
      openAuthPrompt(widget.dataset.loginMessage);
      return;
    }

    const content = String(textarea.value || "").trim();
    if (!content) {
      textarea.focus();
      return;
    }

    sendButton.disabled = true;
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ content })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        if (payload && payload.authRequired) {
          openAuthPrompt(payload.message);
          return;
        }
        throw new Error("chat-send-failed");
      }
      textarea.value = "";
      renderMessages(payload.messages || []);
      setStatus(widget.dataset.subtitle);
      messagesNode.scrollTop = messagesNode.scrollHeight;
    } catch (error) {
      setStatus(widget.dataset.errorLabel);
    } finally {
      sendButton.disabled = false;
    }
  }

  async function toggleLike(event) {
    const authTarget = event.target.closest("[data-chat-auth-like]");
    if (authTarget) {
      openAuthPrompt(widget.dataset.likeMessage || widget.dataset.loginMessage);
      return;
    }

    const target = event.target.closest("[data-chat-like]");
    if (!target) {
      return;
    }
    if (!isAuthenticated) {
      openAuthPrompt(widget.dataset.likeMessage || widget.dataset.loginMessage);
      return;
    }

    try {
      const response = await fetch(`/api/chat/messages/${target.dataset.chatLike}/like`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        if (payload && payload.authRequired) {
          openAuthPrompt(payload.message);
          return;
        }
        throw new Error("chat-like-failed");
      }
      await loadMessages();
    } catch (error) {
      setStatus(widget.dataset.errorLabel);
    }
  }

  toggle?.addEventListener("click", () => setOpenState(true));
  minimize?.addEventListener("click", () => setOpenState(false));
  form?.addEventListener("submit", sendMessage);
  messagesNode?.addEventListener("click", toggleLike);

  setOpenState(getOpenState());
  setStatus(widget.dataset.loadingLabel);
  loadMessages();
  window.setInterval(loadMessages, 8000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadMessages();
    }
  });
})();
