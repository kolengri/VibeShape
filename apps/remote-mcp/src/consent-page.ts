import { escaped, randomToken } from "./request-security"

export function createConsentPage(
  description: { clientName: string; redirectHost: string; redirectIsLoopback: boolean },
  handle: string,
) {
  const nonce = randomToken()
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pair VibeShape</title><body><h1>Pair a VibeShape tab</h1><p>Client: ${escaped(description.clientName)}. Return address: ${escaped(description.redirectHost)}.</p><p>Client names are supplied by the client. Confirm the return address. ${description.redirectIsLoopback ? "A local process may be listening at this address." : ""}</p><p>Open Remote AI in your VibeShape editor. Create a pairing code, enter it here, then approve this client in that exact tab. Reads and draft changes are shared; Apply is reviewed in the editor unless you separately opt in to session auto-apply.</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escaped(handle)}"><label>Pairing code <input name="pairingCode" required maxlength="16" pattern="[A-Fa-f0-9]{16}" autocomplete="off"></label><button type="submit">Request tab approval</button></form><p id="approval-status" role="status"></p><script nonce="${nonce}">
const form = document.querySelector("form");
const button = form.querySelector("button");
const status = document.getElementById("approval-status");
let pending = false;
form.addEventListener("submit", (event) => {
  if (pending) {
    event.preventDefault();
    return;
  }
  pending = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  status.textContent = "Requesting tab approval… Check your VibeShape tab.";
});
// A restored history entry must allow another attempt after a failed navigation.
window.addEventListener("pageshow", () => {
  pending = false;
  button.disabled = false;
  button.removeAttribute("aria-busy");
  status.textContent = "";
});
</script></body></html>`
  return { html, policy }
}
