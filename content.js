(() => {
  const STORAGE_KEY = "chatgpt_message_bookmarks";
  const PROCESSED_ATTR = "data-chatgpt-bookmark-ready";
  const BUTTON_CLASS = "chatgpt-bookmark-button";
  const CONTAINER_CLASS = "chatgpt-bookmark-container";
  const SIDEBAR_ROOT_ID = "chatgpt-bookmark-sidebar-root";
  const OBSERVER_DEBOUNCE_MS = 400;

  const state = {
    bookmarks: [],
    query: "",
    sidebarOpen: false
  };

  let refreshTimer = null;
  let sidebarElements = null;

  function isExtensionContextValid() {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  }

  function sanitizeTags(tags) {
    if (!Array.isArray(tags)) {
      return [];
    }

    const seen = new Set();
    return tags
      .map((tag) => String(tag || "").trim())
      .filter((tag) => {
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function getBookmarks() {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        resolve([]);
        return;
      }

      try {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          if (chrome.runtime?.lastError || !isExtensionContextValid()) {
            resolve([]);
            return;
          }

          resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
        });
      } catch (error) {
        resolve([]);
      }
    });
  }

  function setBookmarks(bookmarks) {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        resolve(false);
        return;
      }

      try {
        chrome.storage.local.set({ [STORAGE_KEY]: bookmarks }, () => {
          resolve(!chrome.runtime?.lastError && isExtensionContextValid());
        });
      } catch (error) {
        resolve(false);
      }
    });
  }

  async function loadBookmarks() {
    state.bookmarks = await getBookmarks();
    renderSidebar();
  }

  async function updateBookmarkTags(id, tags) {
    const bookmarks = await getBookmarks();
    const updated = bookmarks.map((bookmark) => {
      if (bookmark.id !== id) {
        return bookmark;
      }

      return {
        ...bookmark,
        tags: sanitizeTags(tags),
        updatedAt: new Date().toISOString()
      };
    });

    await setBookmarks(updated);
  }

  async function removeBookmark(id) {
    const bookmarks = await getBookmarks();
    await setBookmarks(bookmarks.filter((bookmark) => bookmark.id !== id));
  }

  function makeMessageId(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(index);
      hash |= 0;
    }

    return `msg_${Math.abs(hash)}_${text.length}`;
  }

  function createBookmarkPayload(article) {
    const text = article.innerText.trim();
    const preview = text.replace(/\s+/g, " ").slice(0, 180);
    return {
      id: makeMessageId(text),
      text,
      preview,
      url: window.location.href,
      createdAt: new Date().toISOString(),
      tags: []
    };
  }

  function isLikelyAssistantNode(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (node.closest(`#${SIDEBAR_ROOT_ID}`)) {
      return false;
    }

    const text = node.innerText.trim();
    if (!text || text.length < 20) {
      return false;
    }

    const authorRole = node.getAttribute("data-message-author-role") || "";
    const testId = node.getAttribute("data-testid") || "";
    const label = node.getAttribute("aria-label") || "";
    const containsAssistantMarker = node.querySelector('[data-message-author-role="assistant"]');
    const hasActionButtons = node.querySelector("button");

    return /assistant/i.test(authorRole)
      || /assistant|conversation-turn|response/i.test(testId)
      || /chatgpt|assistant/i.test(label)
      || Boolean(containsAssistantMarker)
      || (node.tagName === "ARTICLE" && hasActionButtons);
  }

  function getAssistantArticles() {
    const selectors = [
      "article",
      '[data-testid^="conversation-turn-"]',
      '[data-message-author-role="assistant"]',
      'div[data-message-author-role="assistant"]'
    ];

    const candidates = new Set();
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        const article = node.closest("article") || node;
        candidates.add(article);
      });
    });

    return Array.from(candidates).filter(isLikelyAssistantNode);
  }

  function createButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M6 3.75A2.25 2.25 0 0 1 8.25 1.5h7.5A2.25 2.25 0 0 1 18 3.75v17.46a.75.75 0 0 1-1.17.624L12 18.39l-4.83 3.444A.75.75 0 0 1 6 21.21V3.75Z"></path>
      </svg>
      <span>Bookmark</span>
    `;
    return button;
  }

  function getArticleButton(article) {
    return article.querySelector(`.${BUTTON_CLASS}`);
  }

  function removeDuplicateButtons(article) {
    const buttons = article.querySelectorAll(`.${BUTTON_CLASS}`);
    buttons.forEach((button, index) => {
      if (index > 0) {
        button.remove();
      }
    });
  }

  async function syncButtonState(button, bookmarkId) {
    const saved = state.bookmarks.some((bookmark) => bookmark.id === bookmarkId);
    button.classList.toggle("is-saved", saved);
    button.querySelector("span").textContent = saved ? "Bookmarked" : "Bookmark";
  }

  async function toggleBookmark(article, button) {
    const payload = createBookmarkPayload(article);
    const existing = state.bookmarks.find((bookmark) => bookmark.id === payload.id);

    if (existing) {
      await removeBookmark(payload.id);
    } else {
      const next = [payload, ...state.bookmarks.filter((bookmark) => bookmark.id !== payload.id)];
      await setBookmarks(next);
    }

    await loadBookmarks();
    await syncButtonState(button, payload.id);
  }

  function findToolbar(article) {
    const selectors = [
      '[data-testid="response-footer"]',
      '[data-testid*="assistant-actions"]',
      '[data-testid*="message-actions"]',
      "div.flex.items-center.gap-1",
      "div.flex.items-center"
    ];

    for (const selector of selectors) {
      const match = article.querySelector(selector);
      if (match) {
        return match;
      }
    }

    return null;
  }

  function ensureContainer(article) {
    const existingButton = getArticleButton(article);
    if (existingButton) {
      return existingButton.parentElement;
    }

    const existingContainer = article.querySelector(`.${CONTAINER_CLASS}`);
    if (existingContainer) {
      return existingContainer;
    }

    const toolbar = findToolbar(article);
    if (toolbar) {
      return toolbar;
    }

    const container = document.createElement("div");
    container.className = CONTAINER_CLASS;
    article.appendChild(container);
    return container;
  }

  async function enhanceArticle(article) {
    removeDuplicateButtons(article);

    if (article.getAttribute(PROCESSED_ATTR) === "true" || getArticleButton(article)) {
      article.setAttribute(PROCESSED_ATTR, "true");
      return;
    }

    const toolbar = ensureContainer(article);
    if (!toolbar) {
      return;
    }

    const button = createButton();
    const payload = createBookmarkPayload(article);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleBookmark(article, button);
    });

    toolbar.appendChild(button);
    article.setAttribute(PROCESSED_ATTR, "true");
    await syncButtonState(button, payload.id);
  }

  function refreshButtons() {
    getAssistantArticles().forEach((article) => {
      enhanceArticle(article);
    });
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshButtons, OBSERVER_DEBOUNCE_MS);
  }

  function formatDate(dateString) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(dateString));
    } catch (error) {
      return dateString;
    }
  }

  function filterBookmarks() {
    const query = state.query.trim().toLowerCase();
    if (!query) {
      return state.bookmarks;
    }

    return state.bookmarks.filter((bookmark) => {
      const haystack = [
        bookmark.text,
        bookmark.preview,
        ...(bookmark.tags || [])
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }

  function buildBookmarkCard(bookmark) {
    const card = document.createElement("article");
    card.className = "chatgpt-bookmark-card";

    const meta = document.createElement("div");
    meta.className = "chatgpt-bookmark-meta";
    meta.innerHTML = `
      <span>${formatDate(bookmark.createdAt)}</span>
      <span>${(bookmark.tags || []).length} tag${(bookmark.tags || []).length === 1 ? "" : "s"}</span>
    `;

    const preview = document.createElement("p");
    preview.className = "chatgpt-bookmark-preview";
    preview.textContent = bookmark.preview || bookmark.text.slice(0, 180);

    const tagRow = document.createElement("div");
    tagRow.className = "chatgpt-bookmark-tags";
    (bookmark.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "chatgpt-bookmark-tag";
      chip.textContent = tag;
      tagRow.appendChild(chip);
    });

    const tagInput = document.createElement("input");
    tagInput.className = "chatgpt-bookmark-tag-input";
    tagInput.type = "text";
    tagInput.placeholder = "Add tags like: important, ui, notes";
    tagInput.value = (bookmark.tags || []).join(", ");
    tagInput.setAttribute("aria-label", "Edit bookmark tags");

    const actions = document.createElement("div");
    actions.className = "chatgpt-bookmark-actions";

    const saveTagsButton = document.createElement("button");
    saveTagsButton.type = "button";
    saveTagsButton.className = "chatgpt-sidebar-button primary";
    saveTagsButton.textContent = "Save Tags";
    saveTagsButton.addEventListener("click", async () => {
      const tags = tagInput.value.split(",").map((tag) => tag.trim()).filter(Boolean);
      await updateBookmarkTags(bookmark.id, tags);
      await loadBookmarks();
      refreshButtons();
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "chatgpt-sidebar-button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(bookmark.text);
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "chatgpt-sidebar-button danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", async () => {
      await removeBookmark(bookmark.id);
      await loadBookmarks();
      refreshButtons();
    });

    actions.append(saveTagsButton, copyButton, deleteButton);
    card.append(meta, preview, tagRow, tagInput, actions);
    return card;
  }

  function createSidebar() {
    if (sidebarElements) {
      return sidebarElements;
    }

    const existingRoot = document.getElementById(SIDEBAR_ROOT_ID);
    if (existingRoot) {
      existingRoot.remove();
    }

    const root = document.createElement("aside");
    root.id = SIDEBAR_ROOT_ID;
    root.className = "chatgpt-bookmark-shell";
    root.innerHTML = `
      <button type="button" class="chatgpt-bookmark-toggle" aria-label="Toggle bookmarks">
        <span>Bookmarks</span>
      </button>
      <section class="chatgpt-bookmark-sidebar" aria-label="Bookmark manager">
        <header class="chatgpt-bookmark-sidebar-header">
          <div>
            <p class="chatgpt-bookmark-eyebrow">ChatGPT Bookmarks</p>
            <h2>Saved Messages</h2>
          </div>
          <button type="button" class="chatgpt-sidebar-button" data-action="close">Close</button>
        </header>
        <label class="chatgpt-bookmark-search">
          <span>Search</span>
          <input type="search" placeholder="Search messages or tags" />
        </label>
        <div class="chatgpt-bookmark-sidebar-actions">
          <button type="button" class="chatgpt-sidebar-button" data-action="refresh">Refresh</button>
        </div>
        <div class="chatgpt-bookmark-empty" hidden>No bookmarks yet. Save a ChatGPT response to see it here.</div>
        <div class="chatgpt-bookmark-list"></div>
      </section>
    `;

    document.body.appendChild(root);

    const toggleButton = root.querySelector(".chatgpt-bookmark-toggle");
    const sidebar = root.querySelector(".chatgpt-bookmark-sidebar");
    const searchInput = root.querySelector('input[type="search"]');
    const list = root.querySelector(".chatgpt-bookmark-list");
    const empty = root.querySelector(".chatgpt-bookmark-empty");
    const closeButton = root.querySelector('[data-action="close"]');
    const refreshButton = root.querySelector('[data-action="refresh"]');

    toggleButton.addEventListener("click", () => {
      state.sidebarOpen = !state.sidebarOpen;
      renderSidebar();
    });

    closeButton.addEventListener("click", () => {
      state.sidebarOpen = false;
      renderSidebar();
    });

    refreshButton.addEventListener("click", loadBookmarks);
    searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
      renderSidebar();
    });

    sidebarElements = {
      root,
      toggleButton,
      sidebar,
      searchInput,
      list,
      empty
    };

    return sidebarElements;
  }

  function renderSidebar() {
    const elements = createSidebar();
    const filtered = filterBookmarks();

    elements.root.classList.toggle("is-open", state.sidebarOpen);
    elements.toggleButton.classList.toggle("is-active", state.sidebarOpen);
    elements.toggleButton.querySelector("span").textContent = state.sidebarOpen
      ? `Bookmarks (${state.bookmarks.length})`
      : "Bookmarks";

    if (elements.searchInput.value !== state.query) {
      elements.searchInput.value = state.query;
    }

    elements.list.replaceChildren(...filtered.map(buildBookmarkCard));
    elements.empty.hidden = filtered.length > 0;
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }

    loadBookmarks();

    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      const article = button.closest("article") || button.closest('[data-testid^="conversation-turn-"]');
      if (!article) {
        return;
      }

      const payload = createBookmarkPayload(article);
      syncButtonState(button, payload.id);
    });
  });

  createSidebar();
  loadBookmarks();
  refreshButtons();
})();




