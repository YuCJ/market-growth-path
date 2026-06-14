interface TelegramSendResult {
  ok: boolean;
  description?: string;
}

export async function sendTextMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as TelegramSendResult;
      if (body.description) {
        message = `${message}: ${body.description}`;
      }
    } catch {
      // Keep the HTTP status when Telegram does not return JSON.
    }
    throw new Error(`sendMessage failed: ${message}`);
  }

  const result = (await response.json()) as TelegramSendResult;
  if (!result.ok) {
    throw new Error(`sendMessage failed: ${result.description ?? "unknown error"}`);
  }
}
