import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { buildUserContent, toPiModel } from "@/src/lib/llm";
import { deriveChatTitle } from "@/src/lib/prompts";
import { LONG_TEXT_PASTE_THRESHOLD, type ChatTurn } from "@/src/lib/types";
import { formatBytes, formatPastedFileName } from "@/src/ui/ChatView";

describe("Chat image & long-text attachments", () => {
  it("uses 5000 characters as the long-text paste threshold", () => {
    expect(LONG_TEXT_PASTE_THRESHOLD).toBe(5000);
  });

  it("formats byte sizes and pasted filenames like 'pasted-YYYYMMDD-HHMMSS.ext'", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(987.3 * 1024)).toBe("987.3 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.50 MB");

    const sampleDate = new Date(2026, 10, 7, 23, 5, 9);
    expect(formatPastedFileName("png", "pasted", sampleDate)).toBe("pasted-20261107-230509.png");
    expect(formatPastedFileName(".txt", "pasted", sampleDate)).toBe("pasted-20261107-230509.txt");
  });

  it("declares image modality support on toPiModel so pi-ai preserves ImageContent blocks", () => {
    const model = toPiModel(
      {
        id: "p1",
        kind: "openai-compatible",
        name: "OpenAI",
        presetId: "openai",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-4o"],
        enabled: true,
        createdAt: 1,
      },
      "gpt-4o",
      "sk-test",
    );
    expect(model.input).toContain("image");
    expect(model.input).toContain("text");
  });

  it("converts base64 Data URL images and 5000+ char long-text attachments into multimodal content blocks", () => {
    const plainTurn: ChatTurn = { role: "user", content: "Hello" };
    expect(buildUserContent(plainTurn)).toBe("Hello");

    const longText = "A".repeat(5200);
    const turnWithBoth: ChatTurn = {
      role: "user",
      content: "Summarize this screenshot and log",
      attachments: [
        {
          id: "att-img",
          kind: "image",
          name: "pasted-20261107-230509.png",
          size: 987300,
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        },
        {
          id: "att-txt",
          kind: "text",
          name: "pasted-20261107-230510.txt",
          size: 5200,
          mimeType: "text/plain",
          textContent: longText,
        },
      ],
    };

    const blocks = buildUserContent(turnWithBoth);
    expect(Array.isArray(blocks)).toBe(true);
    if (Array.isArray(blocks)) {
      expect(blocks).toHaveLength(3);
      expect(blocks[0]).toEqual({
        type: "text",
        text: `<pasted_text name="pasted-20261107-230510.txt" chars="5200">\n${longText}\n</pasted_text>`,
      });
      expect(blocks[1]).toEqual({
        type: "text",
        text: "Summarize this screenshot and log",
      });
      expect(blocks[2]).toEqual({
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      });
    }
  });

  it("derives a fallback chat title when a user turn only has attachments", () => {
    const title = deriveChatTitle([
      {
        role: "user",
        content: "",
        attachments: [{ name: "pasted-20261107-230509.png" }],
      },
    ]);
    expect(title).toBe("pasted-20261107-230509.png");
  });
});
