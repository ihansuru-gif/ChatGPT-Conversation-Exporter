(() => {
  if (window.__cgptConversationExporterLoaded) return;
  window.__cgptConversationExporterLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CGPT_EXPORT") return false;

    try {
      const data = exportConversation(Boolean(message.includeMeta));
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }

    return true;
  });

  function exportConversation(includeMeta) {
    const messages = getMessages();
    const title = getTitle();
    const slug = makeSlug(title);
    const extractedAt = new Date().toLocaleString();

    const body = messages.map((message, index) => {
      const role = message.role === "user" ? "User" : message.role === "assistant" ? "ChatGPT" : `Message ${index + 1}`;
      return `## ${role}\n\n${message.markdown || message.text}`.trim();
    }).join("\n\n---\n\n");

    const meta = [
      `# ${title}`,
      "",
      `- URL: ${location.href}`,
      `- Extracted: ${extractedAt}`,
      `- Messages: ${messages.length}`,
      ""
    ].join("\n");

    const markdown = `${includeMeta ? meta : ""}${body}\n`;
    const text = markdown
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*-\s+/gm, "")
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?|\n?```/g, ""))
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

    return { title, slug, markdown, text, messageCount: messages.length };
  }

  function getMessages() {
    const byDataAttr = [...document.querySelectorAll("[data-message-author-role]")];
    const sourceNodes = byDataAttr.length ? byDataAttr : [...document.querySelectorAll("article")];

    return sourceNodes
      .map((node) => normalizeMessage(node))
      .filter((message) => message.text.length > 0)
      .filter((message, index, list) => {
        const previous = list[index - 1];
        return !previous || previous.text !== message.text || previous.role !== message.role;
      });
  }

  function normalizeMessage(node) {
    const role = node.getAttribute("data-message-author-role") || inferRole(node);
    const contentRoot = node.querySelector(".markdown") || node;
    const markdown = domToMarkdown(contentRoot).trim();
    const text = normalizeWhitespace(contentRoot.innerText || node.textContent || "");

    return {
      role,
      markdown: markdown || text,
      text
    };
  }

  function inferRole(node) {
    const label = [
      node.getAttribute("aria-label"),
      node.textContent?.slice(0, 120)
    ].filter(Boolean).join(" ").toLowerCase();

    if (label.includes("you said") || label.includes("user")) return "user";
    if (label.includes("chatgpt") || label.includes("assistant")) return "assistant";
    return "unknown";
  }

  function domToMarkdown(root) {
    return [...root.childNodes].map((child) => convertNode(child, 0)).join("").trim();
  }

  function convertNode(node, depth) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    const children = () => [...node.childNodes].map((child) => convertNode(child, depth)).join("");
    const text = () => normalizeWhitespace(children());

    if (tag === "br") return "\n";
    if (tag === "p") return `${children().trim()}\n\n`;
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${text()}\n\n`;
    if (tag === "strong" || tag === "b") return `**${children()}**`;
    if (tag === "em" || tag === "i") return `*${children()}*`;
    if (tag === "code") {
      if (node.closest("pre")) return node.textContent || "";
      return `\`${node.textContent || ""}\``;
    }
    if (tag === "pre") {
      const code = node.textContent?.replace(/\n+$/g, "") || "";
      const language = node.querySelector("[class*='language-']")?.className.match(/language-([\w-]+)/)?.[1] || "";
      return `\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }
    if (tag === "a") {
      const href = node.getAttribute("href");
      const label = text() || href || "";
      return href ? `[${label}](${new URL(href, location.href).href})` : label;
    }
    if (tag === "ul" || tag === "ol") {
      return `${[...node.children].map((item, index) => {
        const marker = tag === "ol" ? `${index + 1}.` : "-";
        return `${"  ".repeat(depth)}${marker} ${convertListItem(item, depth + 1).trim()}`;
      }).join("\n")}\n\n`;
    }
    if (tag === "blockquote") return children().trim().split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
    if (tag === "table") return tableToMarkdown(node);
    if (tag === "img") {
      const alt = node.getAttribute("alt") || "image";
      const src = node.getAttribute("src");
      return src ? `![${alt}](${new URL(src, location.href).href})` : "";
    }
    if (tag === "button" || tag === "svg" || tag === "style" || tag === "script") return "";

    const blockTags = new Set(["div", "section", "article", "main"]);
    return blockTags.has(tag) ? `${children()}\n` : children();
  }

  function convertListItem(item, depth) {
    return [...item.childNodes].map((child) => convertNode(child, depth)).join("").replace(/\n{3,}/g, "\n\n");
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll("tr")].map((row) =>
      [...row.children].map((cell) => normalizeWhitespace(cell.innerText || "")).join(" | ")
    );
    if (!rows.length) return "";
    const columnCount = rows[0].split(" | ").length;
    const separator = Array.from({ length: columnCount }, () => "---").join(" | ");
    return `\n${rows[0]}\n${separator}\n${rows.slice(1).join("\n")}\n\n`;
  }

  function normalizeWhitespace(value) {
    return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function getTitle() {
    const title = document.title.replace(/\s*[|-]\s*ChatGPT\s*$/i, "").trim();
    const heading = document.querySelector("main h1, header h1")?.innerText?.trim();
    return heading || title || "ChatGPT Conversation";
  }

  function makeSlug(value) {
    const slug = value
      .toLowerCase()
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);

    return slug || "chatgpt-conversation";
  }
})();
