/**
 * The admin page: one accessible page to teach the helpers, approve what they drafted, switch
 * "act alone" on or off, hear the briefing and read the log.
 *
 * Built for a screen reader first: real headings to jump between, every control labelled, one
 * live region that announces what happened, large text and targets, nothing that needs a mouse,
 * and a "Read aloud" button on the briefing. No outside scripts, fonts or trackers.
 */
export function adminPage(): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tofadachi Helpers</title>
<style>
  :root { --ink: #111; --paper: #fff; --accent: #0b4f9c; --line: #555; --soft: #f1f4f8; --bad: #9b1c1c; --good: #135f2b; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #f4f4f4; --paper: #121212; --accent: #8cc4ff; --line: #aaa; --soft: #1e2630; --bad: #ff9b9b; --good: #8fe0a8; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 20px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--paper); }
  main { max-width: 52rem; margin: 0 auto; padding: 1rem; }
  a { color: var(--accent); }
  .skip { position: absolute; left: -999px; } .skip:focus { left: 1rem; top: 1rem; background: var(--paper); padding: .5rem; z-index: 2; }
  nav ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: .5rem; }
  nav a { display: inline-block; padding: .5rem .75rem; border: 2px solid var(--accent); border-radius: .5rem; text-decoration: none; min-height: 48px; }
  section { border-top: 2px solid var(--line); margin-top: 1.5rem; padding-top: .5rem; }
  label { display: block; font-weight: 600; margin-top: .75rem; }
  input, select, textarea, button { font: inherit; min-height: 48px; }
  input[type=text], input[type=password], select, textarea { width: 100%; padding: .5rem; border: 2px solid var(--line); border-radius: .4rem; background: var(--paper); color: var(--ink); }
  textarea { min-height: 7rem; }
  input[type=checkbox] { width: 1.5rem; height: 1.5rem; min-height: auto; vertical-align: middle; margin-right: .5rem; }
  .check { font-weight: 400; display: flex; align-items: center; }
  button { padding: .5rem 1rem; margin: .5rem .5rem 0 0; border: 2px solid var(--accent); border-radius: .5rem; background: var(--accent); color: var(--paper); cursor: pointer; }
  button.quiet { background: transparent; color: var(--accent); }
  :focus-visible { outline: 4px solid #f5a623; outline-offset: 2px; }
  article { background: var(--soft); border-radius: .5rem; padding: .75rem 1rem; margin: 1rem 0; }
  article h3 { margin: 0 0 .25rem; }
  .meta { font-size: .9rem; }
  pre { white-space: pre-wrap; font: inherit; background: var(--soft); padding: 1rem; border-radius: .5rem; }
  #status { position: sticky; top: 0; background: var(--paper); padding: .25rem 0; font-weight: 600; min-height: 1.5em; }
  .bad { color: var(--bad); } .good { color: var(--good); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to the main part</a>
<main id="main">
  <h1>Tofadachi Helpers</h1>
  <p id="status" role="status" aria-live="polite"></p>

  <section id="signin" aria-labelledby="signin-h">
    <h2 id="signin-h">Sign in</h2>
    <form id="signin-form">
      <label for="key">Admin key</label>
      <input id="key" type="password" autocomplete="current-password" required>
      <label for="person">Your name, for the log</label>
      <input id="person" type="text" autocomplete="name">
      <button type="submit">Sign in</button>
    </form>
  </section>

  <div id="app" hidden>
    <nav aria-label="Parts of this page">
      <ul>
        <li><a href="#review">Waiting for you</a></li>
        <li><a href="#teach">Teach</a></li>
        <li><a href="#knows">What they know</a></li>
        <li><a href="#alone">Act alone</a></li>
        <li><a href="#briefing">Briefing</a></li>
        <li><a href="#outbox">Outbox</a></li>
        <li><a href="#log">Log</a></li>
      </ul>
    </nav>

    <label for="helper">Helper</label>
    <select id="helper"></select>
    <p id="helper-about" class="meta"></p>

    <section id="review" aria-labelledby="review-h" tabindex="-1">
      <h2 id="review-h">Waiting for you</h2>
      <div id="review-list"></div>
    </section>

    <section id="teach" aria-labelledby="teach-h" tabindex="-1">
      <h2 id="teach-h">Teach</h2>
      <form id="teach-form">
        <label for="teach-kind">What are you teaching?</label>
        <select id="teach-kind">
          <option value="answer">A question and its answer</option>
          <option value="rule">A rule it must always keep</option>
          <option value="example">An example of the right tone</option>
        </select>
        <label for="teach-question">Question</label>
        <input id="teach-question" type="text">
        <label for="teach-alternatives">Other ways people ask it, one per line</label>
        <textarea id="teach-alternatives"></textarea>
        <label for="teach-answer">Answer, or the rule</label>
        <textarea id="teach-answer" required></textarea>
        <button type="submit">Teach it</button>
      </form>
      <h3>Try a question</h3>
      <form id="try-form">
        <label for="try-question">Question to try</label>
        <input id="try-question" type="text" required>
        <button type="submit">Try</button>
      </form>
      <p id="try-result" aria-live="polite"></p>
    </section>

    <section id="knows" aria-labelledby="knows-h" tabindex="-1">
      <h2 id="knows-h">What they know</h2>
      <div id="knows-list"></div>
    </section>

    <section id="alone" aria-labelledby="alone-h" tabindex="-1">
      <h2 id="alone-h">Act alone</h2>
      <p>Ticked kinds of message are sent without asking you first. Everything else waits for approval.</p>
      <div id="alone-list"></div>
    </section>

    <section id="briefing" aria-labelledby="briefing-h" tabindex="-1">
      <h2 id="briefing-h">Briefing</h2>
      <button type="button" id="brief-day">Make today's briefing</button>
      <button type="button" id="brief-week" class="quiet">Make this week's briefing</button>
      <button type="button" id="brief-read" class="quiet">Read aloud</button>
      <button type="button" id="brief-stop" class="quiet">Stop reading</button>
      <pre id="brief-text" tabindex="0" aria-label="Briefing text"></pre>
    </section>

    <section id="outbox" aria-labelledby="outbox-h" tabindex="-1">
      <h2 id="outbox-h">Outbox</h2>
      <p>Approved replies that a person still needs to send.</p>
      <div id="outbox-list"></div>
    </section>

    <section id="log" aria-labelledby="log-h" tabindex="-1">
      <h2 id="log-h">Log</h2>
      <button type="button" id="log-refresh" class="quiet">Refresh the log</button>
      <ol id="log-list"></ol>
    </section>
  </div>
</main>
<script>
(function () {
  'use strict';
  var state = { key: '', person: '', overview: null };
  var $ = function (id) { return document.getElementById(id); };
  try { state.key = sessionStorage.getItem('helpers-key') || ''; state.person = sessionStorage.getItem('helpers-person') || ''; } catch (e) {}

  function say(message, bad) {
    var s = $('status'); s.textContent = message; s.className = bad ? 'bad' : 'good';
  }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { 'authorization': 'Bearer ' + state.key, 'content-type': 'application/json', 'x-person': state.person || '' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) { throw new Error(data.message || 'Something went wrong.'); }
        return data;
      });
    });
  }
  function helperId() { return $('helper').value; }
  function when(iso) { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' }); }

  function loadOverview() {
    return api('GET', '/api/overview').then(function (data) {
      state.overview = data;
      var select = $('helper'); var chosen = select.value; select.textContent = '';
      data.helpers.forEach(function (h) {
        select.appendChild(el('option', { value: h.id, text: h.name + ' for ' + h.business + (h.waiting ? ', ' + h.waiting + ' waiting' : '') }));
      });
      if (chosen) select.value = chosen;
      var total = data.helpers.reduce(function (n, h) { return n + h.waiting; }, 0);
      say('Signed in. ' + (total === 0 ? 'Nothing is waiting for you.' : total + (total === 1 ? ' thing is' : ' things are') + ' waiting for you.'));
      return showHelper();
    });
  }
  function current() { return (state.overview.helpers || []).filter(function (h) { return h.id === helperId(); })[0]; }
  function showHelper() {
    var h = current(); if (!h) return;
    $('helper-about').textContent = h.name + ' uses ' + h.brain + ' and knows ' + h.knows + ' answers. Emails go out by ' + state.overview.emailSender + '.';
    return Promise.all([loadReview(), loadKnowledge(), showAlone(), loadOutbox(), loadLog()]);
  }

  function loadReview() {
    return api('GET', '/api/helpers/' + helperId() + '/review').then(function (data) {
      var list = $('review-list'); list.textContent = '';
      if (data.review.length === 0) { list.appendChild(el('p', { text: 'Nothing is waiting.' })); return; }
      data.review.forEach(function (item, i) {
        var id = 'r' + i;
        var title = item.email ? 'Email from ' + item.email.from + ': ' + item.email.subject : 'Question: ' + item.question;
        var answer = el('textarea', { id: id + '-answer' }); answer.value = item.suggestedAnswer || '';
        var teach = el('input', { type: 'checkbox', id: id + '-teach', checked: 'checked' });
        var question = el('input', { type: 'text', id: id + '-question' });
        question.value = item.email ? (item.email.subject || '') : item.question;
        var why = item.suggestedBy === 'taught' ? 'Drafted from an answer you approved before.' : item.suggestedBy === 'brain' ? 'Drafted by the brain. Please check it.' : 'No answer yet. Please write one.';
        list.appendChild(el('article', { 'aria-labelledby': id + '-h' }, [
          el('h3', { id: id + '-h', text: title }),
          el('p', { class: 'meta', text: (item.email ? (item.email.urgent ? 'Urgent. ' : '') + 'Sorted as ' + item.email.category + '. ' : '') + 'Asked ' + item.timesAsked + (item.timesAsked === 1 ? ' time' : ' times') + ', first on ' + when(item.createdAt) + '. ' + why }),
          el('p', { text: item.question }),
          el('label', { for: id + '-answer', text: item.kind === 'reply' ? 'Reply' : 'Answer' }), answer,
          el('label', { class: 'check', for: id + '-teach' }, [teach, document.createTextNode('Teach this answer, so it is used next time')]),
          el('label', { for: id + '-question', text: 'Teach it as the answer to this question' }), question,
          el('button', { type: 'button', text: item.kind === 'reply' ? 'Approve and send' : 'Approve', onclick: function () {
            api('POST', '/api/helpers/' + helperId() + '/review/' + item.id + '/approve', { answer: answer.value, question: question.value, teach: teach.checked })
              .then(function (r) { say('Approved. ' + (r.message || '')); return loadOverview(); })
              .catch(function (e) { say(e.message, true); });
          } }),
          el('button', { type: 'button', class: 'quiet', text: 'Turn down', onclick: function () {
            api('POST', '/api/helpers/' + helperId() + '/review/' + item.id + '/reject', {})
              .then(function () { say('Turned down.'); return loadOverview(); })
              .catch(function (e) { say(e.message, true); });
          } })
        ]));
      });
    });
  }

  function loadKnowledge() {
    return api('GET', '/api/helpers/' + helperId() + '/knowledge').then(function (data) {
      var list = $('knows-list'); list.textContent = '';
      if (data.knowledge.length === 0) { list.appendChild(el('p', { text: 'Nothing taught yet.' })); return; }
      data.knowledge.forEach(function (entry, i) {
        var id = 'k' + i;
        var heading = entry.kind === 'rule' ? 'Rule' : (entry.kind === 'example' ? 'Example: ' : '') + entry.question;
        list.appendChild(el('article', { 'aria-labelledby': id + '-h' }, [
          el('h3', { id: id + '-h', text: heading }),
          el('p', { text: entry.answer }),
          el('p', { class: 'meta', text: 'Used ' + entry.timesUsed + ' times. Taught by ' + entry.taughtBy + '.' + (entry.alternatives.length ? ' Also asked as: ' + entry.alternatives.join('; ') + '.' : '') }),
          el('button', { type: 'button', class: 'quiet', 'aria-label': 'Forget: ' + heading, text: 'Forget', onclick: function () {
            api('DELETE', '/api/helpers/' + helperId() + '/knowledge/' + entry.id).then(function () { say('Forgotten.'); return loadOverview(); }).catch(function (e) { say(e.message, true); });
          } })
        ]));
      });
    });
  }

  function showAlone() {
    var h = current(); var list = $('alone-list'); list.textContent = '';
    if (!h.messageKinds.length) { list.appendChild(el('p', { text: 'This helper sends nothing public.' })); return; }
    h.messageKinds.forEach(function (m, i) {
      var box = el('input', { type: 'checkbox', id: 'a' + i });
      box.checked = h.actAlone.indexOf(m.kind) >= 0;
      box.addEventListener('change', function () {
        api('PUT', '/api/helpers/' + h.id + '/act-alone', { kind: m.kind, on: box.checked })
          .then(function (r) { h.actAlone = r.settings.actAlone; say(box.checked ? m.label + ' will now be sent without asking.' : m.label + ' will wait for your approval.'); })
          .catch(function (e) { box.checked = !box.checked; say(e.message, true); });
      });
      list.appendChild(el('label', { class: 'check', for: 'a' + i }, [box, document.createTextNode(m.label)]));
    });
  }

  function loadOutbox() {
    return api('GET', '/api/outbox').then(function (data) {
      var list = $('outbox-list'); list.textContent = '';
      if (data.outbox.length === 0) { list.appendChild(el('p', { text: 'The outbox is empty.' })); return; }
      data.outbox.forEach(function (item, i) {
        list.appendChild(el('article', { 'aria-labelledby': 'o' + i }, [
          el('h3', { id: 'o' + i, text: 'To ' + item.email.from + ': Re: ' + item.email.subject }),
          el('pre', { text: item.finalAnswer })
        ]));
      });
    });
  }

  function loadLog() {
    return api('GET', '/api/log?limit=60').then(function (data) {
      var list = $('log-list'); list.textContent = '';
      data.log.forEach(function (entry) { list.appendChild(el('li', { text: when(entry.at) + ': ' + entry.text })); });
      if (!data.log.length) list.appendChild(el('li', { text: 'Nothing has happened yet.' }));
    });
  }

  function brief(period) {
    say('Making the briefing.');
    api('POST', '/api/run/' + period + '-briefing').then(function (r) { $('brief-text').textContent = r.result; say('The briefing is ready.'); $('brief-text').focus(); })
      .catch(function (e) { say(e.message, true); });
  }

  $('signin-form').addEventListener('submit', function (event) {
    event.preventDefault();
    state.key = $('key').value; state.person = $('person').value;
    try { sessionStorage.setItem('helpers-key', state.key); sessionStorage.setItem('helpers-person', state.person); } catch (e) {}
    start();
  });
  $('helper').addEventListener('change', function () { showHelper(); });
  $('teach-form').addEventListener('submit', function (event) {
    event.preventDefault();
    api('POST', '/api/helpers/' + helperId() + '/knowledge', {
      kind: $('teach-kind').value, question: $('teach-question').value,
      alternatives: $('teach-alternatives').value.split('\\n'), answer: $('teach-answer').value
    }).then(function () { say('Taught.'); $('teach-form').reset(); return loadOverview(); }).catch(function (e) { say(e.message, true); });
  });
  $('try-form').addEventListener('submit', function (event) {
    event.preventDefault();
    api('POST', '/api/helpers/' + helperId() + '/ask', { question: $('try-question').value }).then(function (r) {
      var where = { exact: 'an exact match', keyword: 'a keyword match', brain: 'the brain', none: 'nowhere: nobody has taught this yet', refused: 'nowhere: it contains words we do not keep' }[r.source];
      $('try-result').textContent = 'Answered from ' + where + '. ' + (r.answer || '');
    }).catch(function (e) { say(e.message, true); });
  });
  $('brief-day').addEventListener('click', function () { brief('daily'); });
  $('brief-week').addEventListener('click', function () { brief('weekly'); });
  $('brief-read').addEventListener('click', function () {
    if (!('speechSynthesis' in window)) { say('This browser cannot read aloud.', true); return; }
    var u = new SpeechSynthesisUtterance($('brief-text').textContent || 'There is no briefing yet.'); u.lang = 'en-GB';
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
  $('brief-stop').addEventListener('click', function () { if ('speechSynthesis' in window) speechSynthesis.cancel(); });
  $('log-refresh').addEventListener('click', function () { loadLog().then(function () { say('The log is up to date.'); }); });

  function start() {
    loadOverview().then(function () {
      $('signin').hidden = true; $('app').hidden = false; $('helper').focus();
    }).catch(function (e) { say(e.message, true); $('signin').hidden = false; $('app').hidden = true; });
  }
  if (state.key) start();
})();
</script>
</body>
</html>`;
}
