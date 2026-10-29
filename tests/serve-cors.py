# Static server that sends CORS headers like Vercel does, standing in for the Vercel site in tests/shell.test.js. Usage: serve-cors.py <port> <dir>
import http.server, sys, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'public, max-age=0, must-revalidate')
        super().end_headers()
    def log_message(self, *a): pass
os.chdir(sys.argv[2]); http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
