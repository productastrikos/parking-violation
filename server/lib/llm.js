/**
 * The LLM seam — the ONE file that knows which model provider we talk to.
 *
 * WHY THIS EXISTS AS ITS OWN FILE. Choosing a provider is a commercial and
 * data-protection decision, made and re-made by someone who is not reading this
 * code. A free tier is right for a demo; a self-hosted model is right the moment
 * real resident data is involved; a paid frontier model is right when the
 * assistant has to work well in Bahasa Malaysia in front of a room. So the
 * provider is a runtime setting, and every other file — the routes, the tools,
 * the phone screens — is written as if it does not exist.
 *
 * WHY THE KEY LIVES HERE AND NOT IN THE APP. An API key shipped inside the
 * Android bundle is extractable in about ninety seconds with `apktool`. The
 * phone talks to OUR server, our server talks to the provider, and the key never
 * leaves the machine it was installed on.
 *
 * TWO KINDS OF CALL:
 *   • complete() — one assistant turn with tools (Sia, the assistant).
 *   • vision()   — one image-understanding call that returns JSON: the field
 *                  app's "Snap-to-Assess" (species, defects, triage from a
 *                  photo) and the console's paper-record digitiser.
 *
 * NOT CONFIGURED IS A SUPPORTED STATE. With no key, both return a clear,
 * non-fatal message and the screens say so; every deterministic engine (risk
 * ratings, the storm model, the day planner, advisories) keeps working. Rules
 * are the floor, the model is the enrichment.
 */

/* ── the presets ────────────────────────────────────────────────────────
   `id` is what goes in LLM_PROVIDER. `visionModel` is the image-capable model
   used by vision(); override with LLM_VISION_MODEL. Free tiers and model ids
   change without notice — llmStatus() surfaces both so a failure is legible. */
export const PROVIDERS = {
  groq: {
    label: 'Astrikos AI',
    dialect: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    // Verified 2026-10-15 to accept images on Groq (≈0.7 s per photo).
    visionModel: 'qwen/qwen3.8-27b',
    // Free-tier models report "over capacity" at busy times (seen 2026-10-16:
    // a 503 after 30 s). A smaller sibling answers instead of the officer waiting.
    fallbackModel: 'openai/gpt-oss-20b',
    visionFallback: 'qwen/qwen3.6-27b',
    free: true,
    keyUrl: 'https://console.groq.com/keys',
    note: 'Free tier, very fast. Tight per-minute rate limits; models rotate.',
  },
  gemini: {
    label: 'Google Gemini',
    dialect: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    visionModel: 'gemini-2.0-flash',
    free: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Generous free tier. Free-tier data may be used for model improvement.',
  },
  openrouter: {
    label: 'OpenRouter',
    dialect: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    visionModel: 'meta-llama/llama-3.2-11b-vision-instruct:free',
    free: true,
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Aggregator. Models with a :free suffix cost nothing but rotate.',
  },
  ollama: {
    label: 'Ollama (self-hosted)',
    dialect: 'openai',
    baseUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:14b',
    visionModel: 'llava:13b',
    free: true,
    needsKey: false,
    keyUrl: 'https://ollama.com/download',
    note: 'Free forever and data never leaves the box. Needs a GPU to be quick.',
  },
  anthropic: {
    label: 'Anthropic Claude',
    dialect: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5-5',
    visionModel: 'claude-opus-5-5',
    free: false,
    keyUrl: 'https://platform.claude.com/settings/keys',
    note: 'Paid. Best tool-calling, vision and Bahasa Malaysia quality; commercial data terms.',
  },
};

const CONFIG = {
  provider: process.env.LLM_PROVIDER || 'none',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || '',
  visionModel: process.env.LLM_VISION_MODEL || '',
  baseUrl: process.env.LLM_BASE_URL || '',
  // Set to "none" to disable failover.
  fallbackModel: process.env.LLM_FALLBACK_MODEL || '',
  visionFallback: process.env.LLM_VISION_FALLBACK || '',
};

const fallbackFor = (kind) => {
  const p = preset();
  const v = kind === 'vision' ? CONFIG.visionFallback || p?.visionFallback : CONFIG.fallbackModel || p?.fallbackModel;
  return v && v !== 'none' ? v : null;
};

/** Worth trying another model: overloaded, rate-limited, server error or timed out — not a bad key or a bad request. */
const retryable = (e) => /^(429|5\d\d)\b|over capacity|timeout|aborted/i.test(String(e?.message || e));

const preset = () => PROVIDERS[CONFIG.provider] ?? null;

/** Is the assistant usable, and if not, exactly what is missing? */
export function llmStatus() {
  const p = preset();
  if (!p) {
    return {
      ready: false,
      vision: false,
      provider: CONFIG.provider,
      reason:
        CONFIG.provider === 'none'
          ? 'No model provider configured. Set LLM_PROVIDER on the server to switch the assistant on.'
          : `Unknown LLM_PROVIDER "${CONFIG.provider}". Known: ${Object.keys(PROVIDERS).join(', ')}.`,
      options: Object.entries(PROVIDERS).map(([id, v]) => ({ id, label: v.label, free: !!v.free, keyUrl: v.keyUrl, note: v.note })),
    };
  }
  if (p.needsKey !== false && !CONFIG.apiKey) {
    return { ready: false, vision: false, provider: CONFIG.provider, label: p.label, reason: `${p.label} is selected but LLM_API_KEY is not set on the server. Get one at ${p.keyUrl}.` };
  }
  return {
    ready: true,
    vision: Boolean(CONFIG.visionModel || p.visionModel),
    provider: CONFIG.provider,
    label: p.label,
    model: CONFIG.model || p.defaultModel,
    visionModel: CONFIG.visionModel || p.visionModel,
    free: !!p.free,
  };
}

function friendlyError(e) {
  const message = String(e?.message || e);
  if (/429|rate.?limit/i.test(message)) return 'The AI service is rate-limited right now — try again in a minute.';
  if (/401|403|api key|authentication/i.test(message)) return 'The AI service rejected the API key. Ask the control room to check the server configuration.';
  if (/timeout|aborted/i.test(message)) return 'The AI service took too long to answer — try again.';
  return `The AI service is unavailable: ${message.slice(0, 240)}`;
}

/* ── call 1: one assistant turn with tools ────────────────────────────── */

/**
 * @param {object}   req
 * @param {string}   req.system     system prompt
 * @param {object[]} req.messages   [{role, content}] plus tool turns (neutral shape)
 * @param {object[]} req.tools      [{name, description, parameters}] JSON Schema
 * @returns {Promise<{text: string, toolCalls: {id,name,args}[]}>}
 *
 * Never throws for a provider-side failure — the caller gets `text` explaining
 * what went wrong, because "rate-limited, try again in a minute" is more use to
 * an officer under a tree than a 500.
 */
export async function complete({ system, messages, tools = [], signal }) {
  const status = llmStatus();
  if (!status.ready) return { text: status.reason, toolCalls: [], notConfigured: true };
  const p = preset();
  const model = CONFIG.model || p.defaultModel;
  const baseUrl = CONFIG.baseUrl || p.baseUrl;
  const call = (m, timeoutMs) =>
    p.dialect === 'anthropic' ? callAnthropic({ model: m, system, messages, tools, signal }) : callOpenAiCompatible({ baseUrl, model: m, system, messages, tools, signal, timeoutMs });
  try {
    return await call(model, 25000);
  } catch (e) {
    const fb = fallbackFor('text');
    if (fb && fb !== model && retryable(e)) {
      try {
        return { ...(await call(fb, 20000)), fallback: fb };
      } catch (e2) {
        return { text: friendlyError(e2), toolCalls: [], error: true };
      }
    }
    return { text: friendlyError(e), toolCalls: [], error: true };
  }
}

/* ── call 2: understand an image, answer in JSON ──────────────────────── */

/**
 * @param {object}   req
 * @param {string}   req.system   what the model is and the JSON it must return
 * @param {string}   req.prompt   the specific question for these images
 * @param {string[]} req.images   data URLs (`data:image/jpeg;base64,…`)
 * @returns {Promise<{ok: boolean, json?: object, text: string, model?: string, label?: string}>}
 *
 * JSON comes back through the prompt, not a provider-specific "JSON mode": the
 * seam has to work identically across five providers, and every one of them
 * can follow "reply with one JSON object". The parse below is tolerant of the
 * prose or code fences small models wrap around it.
 */
export async function vision({ system, prompt, images = [], maxTokens = 1400, signal }) {
  const status = llmStatus();
  if (!status.ready) return { ok: false, notConfigured: true, text: status.reason };
  if (!images.length) return { ok: false, text: 'No image supplied.' };
  const p = preset();
  const primary = CONFIG.visionModel || p.visionModel;
  const baseUrl = CONFIG.baseUrl || p.baseUrl;
  const call = (m, timeoutMs) =>
    p.dialect === 'anthropic'
      ? visionAnthropic({ model: m, system, prompt, images, maxTokens, signal })
      : visionOpenAiCompatible({ baseUrl, model: m, system, prompt, images, maxTokens, signal, timeoutMs });
  let model = primary;
  let text;
  try {
    text = await call(model, 20000);
  } catch (e) {
    const fb = fallbackFor('vision');
    if (!fb || fb === primary || !retryable(e)) return { ok: false, text: friendlyError(e), model, label: p.label };
    model = fb;
    try {
      text = await call(model, 15000);
    } catch (e2) {
      return { ok: false, text: friendlyError(e2), model, label: p.label };
    }
  }
  const json = extractJson(text);
  if (!json) return { ok: false, text: 'The AI answered, but not in the expected format. Try another photo.', raw: text.slice(0, 600), model, label: p.label };
  return { ok: true, json, text, model, label: p.label, fallback: model !== primary };
}

/** Pull the first JSON object out of a model reply. */
export function extractJson(text) {
  if (!text) return null;
  // Reasoning models may open with a <think> block that can itself contain braces.
  text = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ── adapter 1: the OpenAI dialect (Groq, Gemini, OpenRouter, Ollama…) ─── */

async function callOpenAiCompatible({ baseUrl, model, system, messages, tools, signal, timeoutMs = 45000 }) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...messages.map(toOpenAiMessage)],
    // Small open models get worse the longer they ramble; the assistant answers, it does not essay.
    max_tokens: 1200,
    temperature: 0.2,
  };
  if (tools.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = 'auto';
  }
  const json = await postJson(`${baseUrl}/chat/completions`, body, signal, timeoutMs);
  const choice = json.choices?.[0]?.message ?? {};
  return {
    text: choice.content || '',
    toolCalls: (choice.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function?.name,
      // Small models emit almost-JSON arguments; degrade to {} rather than crash the turn.
      args: safeParse(c.function?.arguments),
    })),
  };
}

async function visionOpenAiCompatible({ baseUrl, model, system, prompt, images, maxTokens, signal, timeoutMs = 60000 }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] },
    ],
    max_tokens: maxTokens,
    temperature: 0.1,
  };
  const json = await postJson(`${baseUrl}/chat/completions`, body, signal, timeoutMs);
  return json.choices?.[0]?.message?.content || '';
}

async function postJson(url, body, signal, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(CONFIG.apiKey ? { Authorization: `Bearer ${CONFIG.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Our neutral message shape → the OpenAI one. */
function toOpenAiMessage(m) {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })),
    };
  }
  return { role: m.role, content: m.content };
}

/* ── adapter 2: Anthropic ───────────────────────────────────────────────
   The SDK is imported DYNAMICALLY so a deployment on a free tier does not have
   to install a package it never calls (npm i @anthropic-ai/sdk to enable).

   Request shape for Claude Opus 5.5: adaptive thinking (always on for this
   model), low effort because field turns are latency-sensitive, no sampling
   parameters (rejected on this model), and server-side refusal fallback so a
   safety-classifier false positive on, say, a question about chainsaw felling
   is re-run on another model instead of failing the officer's turn.

   The neutral history this seam carries holds text and tool calls only, never
   thinking blocks — a history without replayed thinking is always a valid
   request, and it cannot trip the conversation-binding check that edited
   histories do. */

let anthropicClient = null;

async function anthropic() {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
      throw new Error('provider "anthropic" needs `npm i @anthropic-ai/sdk`');
    });
    anthropicClient = new Anthropic({ apiKey: CONFIG.apiKey });
  }
  return anthropicClient;
}

const REFUSAL_TEXT = 'The AI declined to answer that request. Rephrase it, or ask the control room.';

async function callAnthropic({ model, system, messages, tools, signal }) {
  const client = await anthropic();
  const res = await client.beta.messages.create(
    {
      model,
      max_tokens: 4000,
      system,
      messages: messages.map(toAnthropicMessage),
      ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );
  if (res.stop_reason === 'refusal') return { text: REFUSAL_TEXT, toolCalls: [] };
  return {
    text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
    toolCalls: res.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
  };
}

async function visionAnthropic({ model, system, prompt, images, maxTokens, signal }) {
  const client = await anthropic();
  const content = [];
  for (const dataUrl of images) {
    const m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1].toLowerCase(), data: m[2] } });
  }
  content.push({ type: 'text', text: prompt });
  const res = await client.beta.messages.create(
    {
      model,
      max_tokens: Math.max(maxTokens, 4000),
      system,
      messages: [{ role: 'user', content }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );
  if (res.stop_reason === 'refusal') throw new Error(REFUSAL_TEXT);
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function toAnthropicMessage(m) {
  if (m.role === 'tool') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} }))],
    };
  }
  return { role: m.role, content: m.content };
}

const safeParse = (s) => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : (s ?? {});
  } catch {
    return {};
  }
};
