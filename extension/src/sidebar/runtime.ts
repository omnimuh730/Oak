export function sendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response as T);
      });
    } catch (err) {
      reject(err);
    }
  });
}
