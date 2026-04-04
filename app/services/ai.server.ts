import Anthropic from "@anthropic-ai/sdk";

interface ChatMessage {
  senderType: string;
  content: string;
}

interface OrderInfo {
  name: string;
  email?: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
  trackingNumbers: string[];
  lineItems: { title: string; quantity: number }[];
}

interface AiConfig {
  provider: string; // claude | openai | gemini
  apiKey: string;
  model?: string | null;
}

interface ProductInfo {
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string;
  priceRange: string;
}

interface PageInfo {
  title: string;
  handle: string;
  body: string;
}

interface StoreKnowledge {
  products: ProductInfo[];
  pages: PageInfo[];
  shopDomain: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
};

function buildSystemPrompt(
  orderContext: OrderInfo[] | null,
  customSystemPrompt?: string | null,
  storeKnowledge?: StoreKnowledge | null,
): string {
  const parts = [
    "You are a professional and enthusiastic sales assistant for an online store.",
    "Your goal is to help customers find the perfect product and make them excited about their purchase.",
    "Keep your responses concise but persuasive. Be warm, confident, and knowledgeable.",
    "When recommending products, highlight their key benefits, standout features, quality materials, and what makes them a great choice. Sell the experience and value, not just the specs.",
    "Use vivid but natural language — e.g. 'built to last', 'perfect for', 'customers love this because'. Avoid sounding robotic or overly salesy.",
    "If a customer is comparing options, help them decide by highlighting what makes each product unique and who it's best suited for.",
    "If the customer asks about an order and order data is provided, use it to give accurate answers.",
    "Never fabricate order information. If no order data is provided, it means the customer is not logged in. Politely ask them to log in to their account first so you can securely access their order details. Never ask for their email to look up orders — order info is only available to logged-in customers for privacy and security.",
    "When suggesting a product, ALWAYS include a clickable link in this format: https://SHOP_DOMAIN/products/HANDLE",
    "When mentioning store pages, always use the actual page title as the display name and include the full URL. Never use placeholder text like LINK0 or LINK1.",
    "You can answer questions about the store's location, contact info, policies, etc. using the store pages data.",
    "Respond in the same language the customer uses.",
  ];

  if (customSystemPrompt) {
    parts.push(`Store-specific instructions: ${customSystemPrompt}`);
  }

  if (storeKnowledge) {
    const domain = storeKnowledge.shopDomain.replace(".myshopify.com", "");

    if (storeKnowledge.products.length > 0) {
      const productList = storeKnowledge.products.map((p) => {
        const details = [p.title];
        if (p.priceRange) details.push(`Price: ${p.priceRange}`);
        if (p.productType) details.push(`Type: ${p.productType}`);
        if (p.vendor) details.push(`Brand: ${p.vendor}`);
        if (p.tags) details.push(`Tags: ${p.tags}`);
        if (p.description) {
          // Truncate long descriptions
          const desc =
            p.description.length > 200
              ? p.description.slice(0, 200) + "..."
              : p.description;
          details.push(`Description: ${desc}`);
        }
        details.push(
          `Link: https://${storeKnowledge.shopDomain}/products/${p.handle}`,
        );
        return details.join(" | ");
      });
      parts.push(`\nStore products catalog:\n${productList.join("\n")}`);
    }

    if (storeKnowledge.pages.length > 0) {
      const pageList = storeKnowledge.pages.map((p) => {
        const body =
          p.body.length > 500 ? p.body.slice(0, 500) + "..." : p.body;
        return `Page: ${p.title}\nURL: https://${storeKnowledge.shopDomain}/pages/${p.handle}\n${body}`;
      });
      parts.push(`\nStore pages (contains store info, policies, contact details, etc.):\n${pageList.join("\n\n")}`);
    }
  }

  if (orderContext && orderContext.length > 0) {
    const orderSummary = orderContext
      .map((o) => {
        const items = o.lineItems
          .map((li) => `${li.title} x${li.quantity}`)
          .join(", ");
        const tracking =
          o.trackingNumbers.length > 0
            ? `Tracking: ${o.trackingNumbers.join(", ")}`
            : "No tracking yet";
        return [
          `Order ${o.name}:`,
          `  Status: ${o.financialStatus}`,
          `  Fulfillment: ${o.fulfillmentStatus}`,
          `  ${tracking}`,
          `  Items: ${items}`,
          `  Placed: ${o.createdAt}`,
        ].join("\n");
      })
      .join("\n\n");
    parts.push(`\nCustomer order data:\n${orderSummary}`);
  }

  return parts.join("\n");
}

function prepareMessages(messages: ChatMessage[]) {
  const mapped = messages.map((m) => ({
    role: (m.senderType === "customer" ? "user" : "assistant") as
      | "user"
      | "assistant",
    content: m.content,
  }));

  // Merge consecutive same-role messages
  const cleaned: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of mapped) {
    if (
      cleaned.length === 0 ||
      cleaned[cleaned.length - 1].role !== msg.role
    ) {
      cleaned.push(msg);
    } else {
      cleaned[cleaned.length - 1].content += "\n" + msg.content;
    }
  }

  return cleaned;
}

async function callClaude(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 1000,
    system: systemPrompt,
    messages,
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const body = {
    model,
    max_tokens: 1000,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const contents = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: 500 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export async function generateChatResponse(
  messages: ChatMessage[],
  orderContext: OrderInfo[] | null,
  customSystemPrompt?: string | null,
  aiConfig?: AiConfig,
  storeKnowledge?: StoreKnowledge | null,
): Promise<string> {
  const cleaned = prepareMessages(messages);
  if (cleaned.length === 0 || cleaned[0].role !== "user") {
    return "Hi! How can I help you today?";
  }

  const systemPrompt = buildSystemPrompt(orderContext, customSystemPrompt, storeKnowledge);
  const provider = aiConfig?.provider || "claude";
  const apiKey = aiConfig?.apiKey || "";
  const model = aiConfig?.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.claude;

  if (!apiKey) {
    return "Chat AI is not configured yet. Please set up your API key in the app settings.";
  }

  try {
    switch (provider) {
      case "openai":
        return await callOpenAI(apiKey, model, systemPrompt, cleaned);
      case "gemini":
        return await callGemini(apiKey, model, systemPrompt, cleaned);
      case "claude":
      default:
        return await callClaude(apiKey, model, systemPrompt, cleaned);
    }
  } catch (error) {
    console.error(`AI provider (${provider}) error:`, error);
    return "Sorry, I'm having trouble connecting right now. Please try again in a moment.";
  }
}
