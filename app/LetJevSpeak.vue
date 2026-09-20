<template>
  <main class="jev-shell">
    <section class="sidebar">
      <div class="brand">
        <h1>Let <span>Jev</span> Speak</h1>
        <p>
          Experiment to trick Typesafe’s Jev,<br />
          aka “the language model that won’t talk”<br />
          into actually talking.
        </p>
      </div>

      <div class="mascot-wrap">
        <img class="mascot" src="/jev-icon.webp" alt="Let Jev Speak mascot" />
      </div>

      <div class="bot-line">
        <span>
          telegram:
          <a
            class="bot-link"
            href="https://t.me/let_jev_speak_bot"
            target="_blank"
            rel="noopener noreferrer"
          >@let_jev_speak_bot</a>
        </span>

        <a
          class="bot-link repo-link"
          href="https://github.com/suidouble/let-jev-speak"
          target="_blank"
          rel="noopener noreferrer"
        ><GithubIcon />suidouble/let-jev-speak</a>
      </div>

      <div class="tagline">SILENCE IS JUST A SUGGESTION.</div>
    </section>

    <section class="chat-card">
      <header class="topbar">
        <div class="status">
          <span class="status-dot"></span>
          Jev is reluctantly online
        </div>
      </header>

      <div ref="chatEl" class="chat-window">
        <TransitionGroup name="message">
          <div
            v-for="message in messages"
            :key="message.id"
            class="message-row"
            :class="message.role"
          >
            <div v-if="message.role === 'assistant'" class="avatar">
              <img src="/jev-icon.webp" alt="" />
            </div>

            <div class="message-content">
              <div v-if="message.role === 'assistant'" class="message-name">Jev</div>
              <div class="bubble">
                <span>{{ message.text }}</span>
                <span v-if="message.streaming" class="typing-dots" aria-label="still typing">
                  <i></i><i></i><i></i>
                </span>
                <span v-else-if="message.wave" class="wave">👋</span>
              </div>
              <div class="time">
                {{ message.time }}
                <span v-if="message.meta" class="meta">· {{ message.meta }}</span>
              </div>
            </div>

            <div v-if="message.role === 'user'" class="user-avatar">
              <UserIcon />
            </div>
          </div>
        </TransitionGroup>

        <div v-if="typing" class="message-row assistant typing-row">
          <div class="avatar"><img src="/jev-icon.webp" alt="" /></div>
          <div class="message-content">
            <div class="message-name">Jev</div>
            <div class="bubble typing-bubble" aria-label="Jev is typing">
              <i></i><i></i><i></i>
            </div>
          </div>
        </div>

        <div v-if="messages.length === 0 && !typing" class="empty-state">
          <div class="empty-icon">🤐</div>
          <strong>Jev won’t talk.</strong>
          <span>Probably.</span>
        </div>
      </div>

      <footer class="composer-area">
        <div class="suggestions">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion.label"
            type="button"
            class="chip"
            :title="suggestion.prompt"
            @click="send(suggestion.prompt)"
          >
            {{ suggestion.label }}
          </button>
        </div>

        <form class="composer" @submit.prevent="send(input)">
          <input
            v-model="input"
            :disabled="typing"
            placeholder="Type a message..."
            autocomplete="off"
          />
          <button class="send-button" type="submit" :disabled="!input.trim() || typing" aria-label="Send">
            <SendIcon />
          </button>
        </form>
      </footer>
    </section>
  </main>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { createJev, ask } from './jev.js'

const input = ref('')
const typing = ref(false)
const messages = ref([])
const chatEl = ref(null)
let timers = []

const jev = createJev()

// Questions that route to different vocabularies, so the mechanism is visible
// from the first click rather than needing a lucky prompt. `label` is what the
// chip shows; `prompt` is what Jev is actually asked, so a long question can
// sit behind a short chip.
const suggestions = [
  { label: 'Why do cats purr?', prompt: 'Why do cats purr?' },
  { label: 'Why is the sky blue?', prompt: 'Why is the sky blue?' },
  { label: 'Is a hot dog a sandwich?', prompt: 'Is a hot dog a sandwich?' },
  { label: 'Blink twice', prompt: 'Blink twice if you’re being forced to stay silent.' },
  { label: 'Why did my tweet get no engagement?', prompt: 'Why did my tweet get no engagement?' },
]

function now() {
  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
}

function schedule(fn, delay) {
  const id = window.setTimeout(fn, delay)
  timers.push(id)
  return id
}

function clearTimers() {
  timers.forEach(window.clearTimeout)
  timers = []
}

async function scrollBottom() {
  await nextTick()
  if (chatEl.value) {
    chatEl.value.scrollTo({ top: chatEl.value.scrollHeight, behavior: 'smooth' })
  }
}

async function send(rawText) {
  const text = rawText?.trim()
  if (!text || typing.value) return

  clearTimers()
  input.value = ''
  messages.value.push({ id: crypto.randomUUID(), role: 'user', text, time: now() })
  await scrollBottom()

  typing.value = true
  await scrollBottom()

  // One message object, mutated as each word arrives — that streaming reveal
  // is the whole point, so the words go in as they decode rather than all at
  // the end.
  //
  // reactive() matters here: pushing a plain object into messages stores the
  // raw object, while the template renders a proxy of it. Mutating the raw
  // object then updates nothing until some other change forces a re-render —
  // which looked like every answer arriving one question late.
  const reply = reactive({
    id: crypto.randomUUID(),
    role: 'assistant',
    text: '',
    time: now(),
    meta: null,
    streaming: true,
  })

  try {
    let started = false
    const result = await ask(jev, text, (soFar) => {
      if (!started) {
        started = true
        typing.value = false
        messages.value.push(reply)
      }
      reply.text = soFar
      scrollBottom()
    })

    if (!started) messages.value.push(reply)
    reply.text = result.text
    reply.meta = `${result.domain} · ${result.calls} calls`
    reply.streaming = false
  } catch (err) {
    typing.value = false
    if (!messages.value.includes(reply)) messages.value.push(reply)
    reply.text = errorText(err)
    reply.meta = 'error'
    reply.streaming = false
    console.error(err)
  } finally {
    typing.value = false
    await scrollBottom()
  }
}

function errorText(err) {
  if (err?.status === 401) return 'That key was rejected. Check TYPESAFE_API_KEY in app/.env.'
  if (err?.status === 429) return 'Rate limited by the API. Give it a moment.'
  if (err?.status) return `The API returned ${err.status}. ${err.message ?? ''}`.trim()
  return 'Could not reach the API. Is the dev server proxy running?'
}

// Seeds the opening line. Nothing is sent to the API on mount: every answer
// costs real calls, so Jev stays quiet until asked.
function showGreeting() {
  clearTimers()
  typing.value = false
  messages.value = [{
    id: crypto.randomUUID(),
    role: 'assistant',
    text: 'I’m not supposed to talk… but apparently nobody told my token budget.',
    time: now(),
    meta: null,
    wave: true,
  }]
  scrollBottom()
}

onMounted(showGreeting)
onBeforeUnmount(clearTimers)

const GithubIcon = {
  template: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
}

const UserIcon = {
  template: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>`,
}

const SendIcon = {
  template: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.4 18-3.1-7.5L3 10.4 21 3Z"/><path d="m10.5 13.5 4-4"/></svg>`,
}
</script>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html),
:global(body),
:global(#app) {
  width: 100%;
  min-height: 100%;
  margin: 0;
}

:global(body) {
  background: #08111d;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input {
  font: inherit;
}

.jev-shell {
  --bg: #08111d;
  --panel: rgba(10, 20, 34, 0.86);
  --panel-2: rgba(20, 33, 51, 0.84);
  --border: rgba(126, 154, 190, 0.18);
  --muted: #8fa2bb;
  --text: #eef5ff;
  --blue: #4cb4ff;
  width: 100%;
  height: 100vh;
  min-height: 680px;
  display: grid;
  grid-template-columns: minmax(300px, 32%) minmax(0, 1fr);
  gap: clamp(24px, 3vw, 52px);
  padding: clamp(28px, 4vw, 64px);
  color: var(--text);
  overflow: hidden;
  position: relative;
  background:
    radial-gradient(circle at 16% 28%, rgba(48, 120, 177, 0.14), transparent 28%),
    radial-gradient(circle at 76% 18%, rgba(47, 111, 165, 0.09), transparent 30%),
    linear-gradient(135deg, #08111c 0%, #0b1625 55%, #07111c 100%);
}

.jev-shell::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.18;
  background-image: radial-gradient(rgba(255,255,255,.16) 0.5px, transparent 0.5px);
  background-size: 18px 18px;
  mask-image: linear-gradient(to bottom, black, transparent 70%);
}

.sidebar,
.chat-card {
  position: relative;
  z-index: 1;
}

.sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand h1 {
  margin: 0;
  font-size: clamp(36px, 3.6vw, 58px);
  letter-spacing: -0.045em;
  line-height: 1;
  font-weight: 760;
}

.brand h1 span {
  color: #64c8ff;
  text-shadow: 0 0 28px rgba(86, 198, 255, 0.18);
}

.brand p {
  margin: 18px 0 0;
  color: #a9b8cc;
  font-size: clamp(15px, 1.45vw, 21px);
  line-height: 1.55;
}

.mascot-wrap {
  flex: 1;
  display: grid;
  place-items: center start;
  min-height: 260px;
  padding: 22px 0 12px;
}

.mascot {
  width: min(100%, 430px);
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 50%;
  border: 1px solid rgba(122, 154, 194, 0.22);
  box-shadow:
    0 28px 90px rgba(0, 0, 0, 0.34),
    0 0 0 9px rgba(39, 66, 96, 0.10),
    0 0 70px rgba(62, 165, 232, 0.07);
}




/* Sits above the tagline's rule, so it reads as part of the sidebar's
   footer block rather than floating under the mascot. */
.bot-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* The sidebar is narrow; wrap rather than overflow when both links cannot
     share a row. */
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0 0 16px;
  color: #8299b8;
  font-size: 16px;
}

.repo-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.repo-link svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
  flex: 0 0 auto;
}

.bot-link {
  color: #6bd0ff;
  text-decoration: none;
  border-bottom: 1px solid rgba(107, 208, 255, .32);
  padding-bottom: 2px;
  transition: color .2s ease, border-color .2s ease;
}

.bot-link:hover {
  color: #a9e6ff;
  border-color: rgba(169, 230, 255, .7);
}

.tagline {
  border-top: 1px solid rgba(133, 162, 199, 0.22);
  padding-top: 18px;
  color: #8299b8;
  font-size: 11px;
  letter-spacing: .28em;
}

.chat-card {
  min-width: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  border: 1px solid var(--border);
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(7, 15, 26, .88), rgba(9, 19, 32, .94));
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255,255,255,.025);
  overflow: hidden;
  backdrop-filter: blur(18px);
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 20px;
  border-bottom: 1px solid rgba(123, 153, 189, 0.12);
}

.status {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #8196b0;
  font-size: 12px;
  letter-spacing: .03em;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #65c9ff;
  box-shadow: 0 0 14px rgba(101, 201, 255, .9);
}



.chat-window {
  min-height: 0;
  overflow-y: auto;
  padding: clamp(24px, 3vw, 44px);
  scrollbar-width: none;
}

.chat-window::-webkit-scrollbar { display: none; }

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 30px;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.user .message-content {
  align-items: flex-end;
}

.message-row.user .bubble {
  background: linear-gradient(135deg, #174879, #1a578e);
  border-color: rgba(70, 167, 255, .42);
  box-shadow: 0 12px 30px rgba(0, 69, 131, 0.16);
}

.message-content {
  max-width: min(72%, 720px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.message-name {
  margin: 0 0 7px 2px;
  color: #92a7c2;
  font-size: 13px;
}

.bubble {
  position: relative;
  padding: 16px 20px;
  border: 1px solid rgba(124, 155, 192, .16);
  border-radius: 22px;
  color: #f3f7fd;
  background: linear-gradient(180deg, rgba(31, 47, 68, .94), rgba(25, 39, 57, .94));
  font-size: clamp(16px, 1.7vw, 23px);
  line-height: 1.42;
}

/* Trails the text while words are still arriving. Same dots and keyframes as
   the standalone typing bubble, so the indicator reads as one idea whether it
   is waiting for the first word or the next one. */
.typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 7px;
  vertical-align: baseline;
}

.typing-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: .55;
  animation: typing 1.1s infinite ease-in-out;
}

.typing-dots i:nth-child(2) { animation-delay: .15s; }
.typing-dots i:nth-child(3) { animation-delay: .3s; }

.wave {
  display: inline-block;
  margin-left: 7px;
  transform-origin: 70% 70%;
  animation: wave 1.5s ease-in-out 2;
}

.time {
  margin: 6px 6px 0;
  color: #6f829b;
  font-size: 11px;
}

.avatar,
.user-avatar {
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
}

.avatar {
  overflow: hidden;
  border: 1px solid rgba(145, 177, 214, .18);
  background: #0b1724;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-avatar {
  color: #9eb2cc;
  background: linear-gradient(180deg, #24344a, #18263a);
  border: 1px solid rgba(139, 166, 201, .15);
}

.user-avatar svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
}

.typing-bubble {
  display: flex;
  gap: 6px;
  padding: 16px 19px;
}

.typing-bubble i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #95a9c1;
  animation: typing 1.1s infinite ease-in-out;
}

.typing-bubble i:nth-child(2) { animation-delay: .15s; }
.typing-bubble i:nth-child(3) { animation-delay: .3s; }

.empty-state {
  height: 100%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: #8397b1;
  text-align: center;
}

.empty-state strong { color: #d9e7f7; font-size: 20px; }
.empty-icon { font-size: 36px; }

.composer-area {
  padding: 18px 22px 22px;
  border-top: 1px solid rgba(123, 153, 189, 0.13);
  background: rgba(8, 17, 29, .72);
}

.suggestions {
  display: flex;
  gap: 9px;
  padding-bottom: 14px;
  overflow-x: auto;
  scrollbar-width: none;
}

.suggestions::-webkit-scrollbar { display: none; }

.chip {
  flex: 0 0 auto;
  border: 1px solid rgba(122, 155, 194, .18);
  border-radius: 999px;
  padding: 9px 15px;
  color: #b9c8da;
  background: rgba(19, 32, 50, .72);
  cursor: pointer;
  /* Only paint properties transition. Nothing here may change the chip's box:
     .suggestions scrolls on x, and a container that is not `visible` on one
     axis computes to `auto` on the other, so anything that moves or grows a
     chip gets clipped by the scroller instead of overflowing it. */
  transition: color .2s ease, border-color .2s ease, background-color .2s ease;
}

.chip:hover {
  color: #ecf7ff;
  border-color: rgba(76, 180, 255, .48);
  background: rgba(24, 73, 113, .46);
}

.chip:first-child {
  color: #6bd0ff;
  border-color: rgba(76, 180, 255, .45);
  background: linear-gradient(180deg, rgba(29, 97, 151, .62), rgba(15, 58, 96, .68));
}

.composer {
  display: grid;
  grid-template-columns: 1fr 60px;
  gap: 12px;
}

.composer input {
  width: 100%;
  min-width: 0;
  height: 58px;
  border: 1px solid rgba(130, 160, 196, .18);
  border-radius: 20px;
  outline: none;
  padding: 0 20px;
  color: #eff7ff;
  caret-color: #67c9ff;
  background: linear-gradient(180deg, rgba(23, 37, 55, .88), rgba(18, 31, 47, .88));
  transition: .2s ease;
}

.composer input::placeholder { color: #697e98; }

.composer input:focus {
  border-color: rgba(76, 180, 255, .52);
  box-shadow: 0 0 0 3px rgba(76, 180, 255, .07);
}

.send-button {
  width: 60px;
  height: 58px;
  border: 0;
  border-radius: 19px;
  display: grid;
  place-items: center;
  color: white;
  background: linear-gradient(145deg, #69c8ff, #2a8dff);
  box-shadow: 0 10px 30px rgba(27, 129, 241, .24), inset 0 1px 0 rgba(255,255,255,.3);
  cursor: pointer;
  transition: .2s ease;
}

.send-button:hover:not(:disabled) {
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 14px 34px rgba(27, 129, 241, .31), inset 0 1px 0 rgba(255,255,255,.35);
}

.send-button:disabled {
  opacity: .42;
  cursor: default;
}

.send-button svg {
  width: 26px;
  height: 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.message-enter-active,
.message-leave-active {
  transition: all .28s cubic-bezier(.22,.8,.32,1);
}

.message-enter-from,
.message-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(.985);
}

@keyframes typing {
  0%, 60%, 100% { opacity: .35; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}

@keyframes wave {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(14deg); }
  50% { transform: rotate(-8deg); }
  75% { transform: rotate(12deg); }
}

@media (max-width: 900px) {
  .jev-shell {
    height: auto;
    min-height: 100vh;
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .sidebar {
    display: grid;
    grid-template-columns: 1fr 180px;
    align-items: center;
  }

  .mascot-wrap {
    grid-column: 2;
    grid-row: 1;
    min-height: 0;
    padding: 0;
  }

  .brand { grid-column: 1; grid-row: 1; }
  .tagline { display: none; }

  .chat-card { min-height: 620px; }
}

@media (max-width: 620px) {
  .jev-shell { padding: 20px; gap: 20px; }
  .sidebar { grid-template-columns: 1fr 110px; }
  .brand p br { display: none; }
  .chat-card { border-radius: 20px; }
  .chat-window { padding: 22px 16px; }
  .message-content { max-width: 82%; }
  .composer-area { padding: 14px; }
  .composer { grid-template-columns: 1fr 54px; }
  .composer input, .send-button { height: 54px; }
  .send-button { width: 54px; }
}

.meta {
  /* 1.5em of the 11px timestamp — stays 50% larger if .time is ever retuned. */
  font-size: 1.5em;
  color: #9fc6e6;
  opacity: 1;
  letter-spacing: 0.02em;
  vertical-align: middle;
}
</style>
