# Static server that does NOT resolve directory URLs to index.html (worst-case host)
import http.server, sys, os
class H(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        p = self.translate_path(self.path)
        if os.path.isdir(p):
            self.send_error(404, "no directory index"); return None
        return super().send_head()
os.chdir(sys.argv[2]); http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
