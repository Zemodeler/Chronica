// Answers a voice_letters prompt by giving each letter its stated substance as the body.
export function autoLetters(txt) {
  const out = [];
  for (const blk of txt.split(/^LETTER /m).slice(1)) {
    const id = /^\[([^\]]+)\]/.exec(blk)?.[1];
    const subject = /^Subject: (.*)$/m.exec(blk)?.[1] ?? "A letter";
    const body = /It must say, in substance(?:, as he says it)?: (.*)$/m.exec(blk)?.[1] ?? "Greeting.";
    out.push({ id, subject: subject.slice(0, 80), body });
  }
  return JSON.stringify({ letters: out });
}
