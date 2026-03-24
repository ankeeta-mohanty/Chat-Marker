const BOOKMARKS_KEY = "chatgpt_message_bookmarks";

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen = new Set();
  return tags
    .map((tag) => String(tag || "").trim())
    .filter((tag) => {
      if (!tag || seen.has(tag.toLowerCase())) {
        return false;
      }
      seen.add(tag.toLowerCase());
      return true;
    });
}

function getBookmarks() {
  return new Promise((resolve) => {
    chrome.storage.local.get([BOOKMARKS_KEY], (result) => {
      resolve(Array.isArray(result[BOOKMARKS_KEY]) ? result[BOOKMARKS_KEY] : []);
    });
  });
}

function setBookmarks(bookmarks) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks }, () => resolve());
  });
}

async function addBookmark(bookmark) {
  const bookmarks = await getBookmarks();
  const existingIndex = bookmarks.findIndex((item) => item.id === bookmark.id);

  const normalized = {
    ...bookmark,
    tags: sanitizeTags(bookmark.tags),
    updatedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    bookmarks[existingIndex] = {
      ...bookmarks[existingIndex],
      ...normalized
    };
  } else {
    bookmarks.unshift(normalized);
  }

  await setBookmarks(bookmarks);
  return normalized;
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
  const filtered = bookmarks.filter((bookmark) => bookmark.id !== id);
  await setBookmarks(filtered);
}

