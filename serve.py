"""Serve the packaged Canopy website on this computer."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


def main():
    site = Path(__file__).resolve().parent / "site"
    handler = partial(SimpleHTTPRequestHandler, directory=str(site))
    SimpleHTTPRequestHandler.extensions_map[".mjs"] = "text/javascript"

    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Canopy is running at {url}", flush=True)
        try:
            webbrowser.open(url)
        except webbrowser.Error:
            pass
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
