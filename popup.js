const statusEl = document.querySelector("#status");
const buttons = [...document.querySelectorAll("button")];
const includeMetaEl = document.querySelector("#includeMeta");

document.querySelector("#copyMarkdown").addEventListener("click", () => run("copy-md"));
document.querySelector("#downloadMarkdown").addEventListener("click", () => run("download-md"));
document.querySelector("#downloadText").addEventListener("click", () => run("download-txt"));

async function run(action) {
  setBusy(true);
  try {
    const tab = await getActiveTab();
    if (!isChatGptUrl(tab.url)) {
      throw new Error("ChatGPT 대화 페이지에서만 사용할 수 있습니다.");
    }

    const result = await extractConversation(tab.id, includeMetaEl.checked);
    if (!result?.markdown || result.messageCount === 0) {
      throw new Error("대화 내용을 찾지 못했습니다. 페이지가 완전히 열린 뒤 다시 시도하세요.");
    }

    if (action === "copy-md") {
      await navigator.clipboard.writeText(result.markdown);
      statusEl.textContent = `${result.messageCount}개 메시지를 Markdown으로 복사했습니다.`;
      return;
    }

    const text = action === "download-txt" ? result.text : result.markdown;
    const extension = action === "download-txt" ? "txt" : "md";
    const mime = action === "download-txt" ? "text/plain" : "text/markdown";
    await downloadText(text, `${result.slug || "chatgpt-conversation"}.${extension}`, mime);
    statusEl.textContent = `${result.messageCount}개 메시지를 ${extension.toUpperCase()} 파일로 저장했습니다.`;
  } catch (error) {
    statusEl.textContent = error.message || String(error);
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  buttons.forEach((button) => {
    button.disabled = isBusy;
  });
  if (isBusy) statusEl.textContent = "대화를 읽는 중입니다...";
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      tab ? resolve(tab) : reject(new Error("활성 탭을 찾지 못했습니다."));
    });
  });
}

function isChatGptUrl(url = "") {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
}

async function extractConversation(tabId, includeMeta) {
  try {
    return await sendExtractMessage(tabId, includeMeta);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return sendExtractMessage(tabId, includeMeta);
  }
}

function sendExtractMessage(tabId, includeMeta) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "CGPT_EXPORT", includeMeta }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      response?.ok ? resolve(response.data) : reject(new Error(response?.error || "추출에 실패했습니다."));
    });
  });
}

function downloadText(text, filename, type) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
      URL.revokeObjectURL(url);
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(downloadId);
    });
  });
}
