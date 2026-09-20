// handlers/message.js — one `message` update.
//
// Answers a question by decoding it one word at a time out of TypeSafe's
// classification API, streaming the partial answer as a live draft and
// persisting the finished sentence as a real message.

import 'lib/compat';

import { api } from 'sdk';
import { createSpeaker, answerQuestion, MAX_WORDS } from 'lib/answer';
import { DraftStream } from 'lib/streamer';
import { getConfig, setConfig, takeQuota } from 'lib/store';
import { DOMAIN_KEYS } from 'lib/vocabs';

const START = `An experiment: forcing Jev, a model that can't speak, to speak anyway.

Jev is a classifier — it only ever returns a label and a probability, never a
sentence. This bot asks it "what is the next word?" over and over, so you can
watch an answer assemble itself one word at a time.

The answers are short and often ungrammatical. That is the point.

Just send me a question. /domains lists the vocabularies.

Source: https://github.com/jeka-kiselyov/let-jev-speak`;

// The count comes from the vocabularies themselves — a literal here would go
// stale the moment a pack is added. Read from lib/vocabs rather than from a
// LetJevSpeak instance, so /help still works before the API key is set.
const HELP = `Send any question and I will answer it in ${MAX_WORDS} words or fewer.

/domains  the ${DOMAIN_KEYS.length} vocabularies I can draw on
/help     this message

Each answer costs about ${MAX_WORDS + 1} API calls, so there is a limit of
20 answers per hour.`;

export default async function (message, ctx) {
  const chatId = message.chat?.id;
  const userId = message.from?.id ?? chatId;
  const text = (message.text ?? '').trim();

  // Seeding path: reachable only through `tgcloud run`, never from a real
  // update, so the API key never travels through a chat message.
  if (message.__setkey) {
    await setConfig('typesafe_api_key', message.__setkey);
    return { ok: true, stored: 'typesafe_api_key' };
  }

  // Dry run: exercise routing and decoding with no Telegram calls. Reachable
  // only through `tgcloud run`, and useful for checking the pipeline after a
  // deploy without needing a live chat.
  if (message.__dry) {
    const apiKeyDry = await getConfig('typesafe_api_key');
    if (!apiKeyDry) return { error: 'no api key' };
    const jevDry = createSpeaker(apiKeyDry);
    const t0 = Date.now();
    const frames = [];
    const r = await answerQuestion(jevDry, text, {
      onWord: async (soFar) => { frames.push(`${Date.now() - t0}ms ${soFar}`); },
    });
    return {
      question: text,
      answer: r.text,
      domain: r.domain,
      calls: r.calls,
      ms: Date.now() - t0,
      frames,
    };
  }

  if (!chatId || !text) return { skipped: 'no text' };

  if (text === '/start') {
    await api.sendMessage({ chat_id: chatId, text: START });
    return { ok: true };
  }
  if (text === '/help') {
    await api.sendMessage({ chat_id: chatId, text: HELP });
    return { ok: true };
  }

  const apiKey = await getConfig('typesafe_api_key');
  if (!apiKey) {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Not configured yet — no TypeSafe API key is set.',
    });
    return { error: 'no api key' };
  }

  const jev = createSpeaker(apiKey);

  if (text === '/domains') {
    const lines = jev.domains.map((d) => `${d.key} — ${d.size} words`);
    await api.sendMessage({
      chat_id: chatId,
      text: `${jev.domainKeys.length} vocabularies:\n\n${lines.join('\n')}`,
    });
    return { ok: true };
  }

  if (text.startsWith('/')) {
    await api.sendMessage({ chat_id: chatId, text: 'Unknown command. Try /help.' });
    return { ok: true };
  }

  const quota = await takeQuota(userId);
  if (!quota.allowed) {
    await api.sendMessage({
      chat_id: chatId,
      text: `Rate limit reached. Try again in ${quota.resetInMin} minutes.`,
    });
    return { error: 'rate limited' };
  }

  const draft = new DraftStream(chatId);
  const started = Date.now();

  try {
    // Routing happens first, so the draft can show the chosen vocabulary
    // while the words are still being decoded.
    let labelled = false;
    const result = await answerQuestion(jev, text, {
      onWord: async (soFar) => {
        if (!labelled) labelled = true;
        await draft.show(soFar);
      },
    });

    await draft.show(result.text, { force: true });

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    await draft.finish(
      `${result.text}\n\n— ${result.domain} · ${result.calls} calls · ${seconds}s`,
    );

    console.log(`answered "${text}" -> "${result.text}" ` +
      `[${result.domain}] ${result.calls} calls ${seconds}s ` +
      `frames=${draft.frames} skipped=${draft.skipped}`);

    return { ok: true, text: result.text, domain: result.domain, calls: result.calls };
  } catch (err) {
    console.error(err);
    await api.sendMessage({
      chat_id: chatId,
      text: 'Something went wrong decoding that. Try again?',
    });
    return { error: String(err?.message ?? err) };
  }
}
