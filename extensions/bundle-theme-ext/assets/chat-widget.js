(function () {
  "use strict";

  var root = document.getElementById("bc-chat-root");
  if (!root) return;

  var APP_URL = root.dataset.appUrl;
  var SHOP = root.dataset.shop;
  var CUSTOMER_NAME = root.dataset.customerName || "";
  var CUSTOMER_EMAIL = root.dataset.customerEmail || "";
  var defaultWelcome = root.dataset.welcome || "Hi! How can I help you today?";
  var WELCOME = CUSTOMER_NAME
    ? "Hi " + CUSTOMER_NAME + "! " + defaultWelcome
    : defaultWelcome;

  // Session ID for conversation continuity
  var SESSION_KEY = "bc-chat-session";
  var sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  var isOpen = false;
  var sending = false;

  // Product card data cache keyed by handle
  var productCardMap = {};

  // Build DOM
  root.innerHTML =
    '<div class="bc-panel" id="bc-panel">' +
      '<div class="bc-header">' +
        '<p class="bc-header-title">Chat with us</p>' +
        '<button class="bc-close" id="bc-close" aria-label="Close chat">' +
          '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
        "</button>" +
      "</div>" +
      '<div class="bc-messages" id="bc-messages"></div>' +
      '<div class="bc-input-area">' +
        '<input class="bc-input" id="bc-input" type="text" placeholder="Type a message..." maxlength="2000" />' +
        '<button class="bc-send" id="bc-send" aria-label="Send">' +
          '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
        "</button>" +
      "</div>" +
    "</div>" +
    '<button class="bc-bubble" id="bc-bubble" aria-label="Open chat">' +
      '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>' +
    "</button>";

  var panel = document.getElementById("bc-panel");
  var bubble = document.getElementById("bc-bubble");
  var closeBtn = document.getElementById("bc-close");
  var messagesEl = document.getElementById("bc-messages");
  var input = document.getElementById("bc-input");
  var sendBtn = document.getElementById("bc-send");

  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.add("bc-open");
      bubble.style.display = "none";
      input.focus();
      if (messagesEl.children.length === 0) {
        loadHistory();
      }
    } else {
      panel.classList.remove("bc-open");
      bubble.style.display = "flex";
    }
  }

  function buildProductCardEl(product, url) {
    var card = document.createElement("a");
    card.href = url;
    card.className = "bc-product-card";
    card.target = "_blank";
    card.rel = "noopener";

    if (product.imageUrl) {
      var img = document.createElement("img");
      img.className = "bc-product-card__img";
      img.src = product.imageUrl;
      img.alt = product.title;
      card.appendChild(img);
    }

    var info = document.createElement("div");
    info.className = "bc-product-card__info";

    var title = document.createElement("p");
    title.className = "bc-product-card__title";
    title.textContent = product.title;
    info.appendChild(title);

    if (product.priceRange) {
      var price = document.createElement("p");
      price.className = "bc-product-card__price";
      price.textContent = product.priceRange;
      info.appendChild(price);
    }

    card.appendChild(info);
    return card;
  }

  /**
   * Parse AI message content and build DOM nodes.
   * - Product links (/products/handle) become product cards if data is available
   * - Other markdown links become styled links
   * - **bold** is rendered
   * - Newlines become line breaks
   */
  function renderAiMessage(text, container) {
    var productCards = [];
    var cardHandles = {};

    // Step 1: Replace markdown links [text](url) with placeholders
    var placeholders = [];
    var processed = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (full, linkText, url) {
      var productMatch = url.match(/\/products\/([\w-]+)/);
      if (productMatch) {
        var handle = productMatch[1];
        var product = productCardMap[handle];
        if (product && !cardHandles[handle]) {
          cardHandles[handle] = true;
          productCards.push({ product: product, url: url });
          return ""; // Remove inline, card appended later
        }
      }
      var idx = placeholders.length;
      placeholders.push({ type: "link", text: linkText, url: url });
      return "\x00LINK" + idx + "\x00";
    });

    // Step 2: Replace bare product URLs
    processed = processed.replace(/(https?:\/\/[^\s,.)]+\/products\/([\w-]+))/g, function (url, _full, handle) {
      var product = productCardMap[handle];
      if (product && !cardHandles[handle]) {
        cardHandles[handle] = true;
        productCards.push({ product: product, url: url });
        return "";
      }
      var idx = placeholders.length;
      placeholders.push({ type: "link", text: url, url: url });
      return "\x00LINK" + idx + "\x00";
    });

    // Step 3: Replace bare non-product URLs
    processed = processed.replace(/(https?:\/\/[^\s,.)]+)/g, function (url) {
      var idx = placeholders.length;
      placeholders.push({ type: "link", text: url, url: url });
      return "\x00LINK" + idx + "\x00";
    });

    // Step 4: Clean up empty markdown artifacts
    processed = processed.replace(/\(\s*\)/g, "");
    processed = processed.replace(/\[\s*\]/g, "");

    // Step 5: Split by bold markers and placeholders, build DOM
    // Split into segments by **bold**, \x00LINKn\x00, and newlines
    var parts = processed.split(/(\*\*[^*]+\*\*|\x00LINK\d+\x00|\n)/g);

    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) continue;

      if (part === "\n") {
        container.appendChild(document.createElement("br"));
      } else if (part.match(/^\*\*(.+)\*\*$/)) {
        var strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        container.appendChild(strong);
      } else if (part.match(/^\x00LINK(\d+)\x00$/)) {
        var linkIdx = parseInt(part.match(/\d+/)[0], 10);
        var linkData = placeholders[linkIdx];
        var a = document.createElement("a");
        a.href = linkData.url;
        a.className = "bc-link";
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = linkData.text;
        container.appendChild(a);
      } else {
        container.appendChild(document.createTextNode(part));
      }
    }

    // Append product cards
    if (productCards.length > 0) {
      var cardsContainer = document.createElement("div");
      cardsContainer.className = "bc-product-cards";
      productCards.forEach(function (item) {
        cardsContainer.appendChild(buildProductCardEl(item.product, item.url));
      });
      container.appendChild(cardsContainer);
    }
  }

  function addMessageToUI(content, senderType, products) {
    // Cache any product card data
    if (products) {
      products.forEach(function (p) {
        productCardMap[p.handle] = p;
      });
    }

    var div = document.createElement("div");
    div.className = "bc-msg bc-msg-" + senderType;

    if (senderType === "ai") {
      renderAiMessage(content, div);
    } else {
      div.textContent = content;
    }

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    var el = document.getElementById("bc-typing");
    if (!el) {
      var typing = document.createElement("div");
      typing.className = "bc-typing bc-visible";
      typing.id = "bc-typing";
      typing.innerHTML =
        '<span class="bc-dot"></span><span class="bc-dot"></span><span class="bc-dot"></span>';
      messagesEl.appendChild(typing);
    } else {
      el.classList.add("bc-visible");
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById("bc-typing");
    if (el) el.remove();
  }

  function sendMessage() {
    var text = input.value.trim();
    if (!text || sending) return;

    sending = true;
    sendBtn.disabled = true;
    input.value = "";

    addMessageToUI(text, "customer");
    showTyping();

    fetch(APP_URL + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop: SHOP,
        sessionId: sessionId,
        message: text,
        customerEmail: CUSTOMER_EMAIL || undefined,
      }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        hideTyping();
        if (data.message) {
          addMessageToUI(data.message.content, data.message.senderType, data.productCards);
        }
        if (data.error) {
          addMessageToUI(
            "Sorry, something went wrong. Please try again.",
            "ai"
          );
        }
      })
      .catch(function () {
        hideTyping();
        addMessageToUI(
          "Sorry, I couldn't connect. Please try again later.",
          "ai"
        );
      })
      .finally(function () {
        sending = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  function loadHistory() {
    // Show welcome message first
    addMessageToUI(WELCOME, "ai");

    fetch(
      APP_URL +
        "/api/chat/history?shop=" +
        encodeURIComponent(SHOP) +
        "&sessionId=" +
        encodeURIComponent(sessionId)
    )
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.messages && data.messages.length > 0) {
          // Clear welcome and show actual history
          messagesEl.innerHTML = "";
          data.messages.forEach(function (msg) {
            addMessageToUI(msg.content, msg.senderType);
          });
        }
      })
      .catch(function () {
        // Keep the welcome message on error
      });
  }

  // Event listeners
  bubble.addEventListener("click", toggleChat);
  closeBtn.addEventListener("click", toggleChat);
  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
})();
