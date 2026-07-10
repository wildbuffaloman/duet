// WKWebView latency-bench stub — the M1.5 benchmark gate (ROADMAP).
// Loads public/bench/latency.html in a real WKWebView (what Tauri/wry uses on macOS),
// prints the JSON the page posts via webkit.messageHandlers.bench, then exits.
// Build:  swiftc -O -framework Cocoa -framework WebKit -o bench/wkwebview_bench bench/wkwebview_bench.swift
// Run:    bench/wkwebview_bench [url]   (default http://127.0.0.1:7433/bench/latency.html)
import Cocoa
import WebKit

final class Bench: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var web: WKWebView?
    func userContentController(_ u: WKUserContentController, didReceive message: WKScriptMessage) {
        if let s = message.body as? String { print(s) }
        exit(0)
    }
    // Fallback + visibility diagnostics: poll bench progress; print results if postMessage is missed.
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
            self.web?.evaluateJavaScript(
                "JSON.stringify({p: window.__benchProgress||0, done: (document.getElementById('results').dataset.done||null), txt: document.getElementById('results').dataset.done ? document.getElementById('results').textContent : ''})"
            ) { result, _ in
                guard let s = result as? String,
                      let d = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { return }
                if d["done"] as? String == "1" {
                    print(d["txt"] as? String ?? "")
                    exit(0)
                }
                FileHandle.standardError.write(Data("progress: \(d["p"] ?? 0)\n".utf8))
            }
        }
    }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError error: Error) {
        FileHandle.standardError.write(Data("provisional nav failed: \(error)\n".utf8))
        exit(3)
    }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError error: Error) {
        FileHandle.standardError.write(Data("nav failed: \(error)\n".utf8))
        exit(3)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let bench = Bench()
let conf = WKWebViewConfiguration()
conf.userContentController.add(bench, name: "bench")

let frame = NSRect(x: 120, y: 120, width: 960, height: 600)
let webView = WKWebView(frame: frame, configuration: conf)
webView.navigationDelegate = bench

bench.web = webView

let win = NSWindow(contentRect: frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
win.title = "duet renderer bench (WKWebView)"
win.contentView = webView
// Launched from a background process: force real visibility, or WebKit suspends rAF and the bench stalls.
win.level = .floating
win.orderFrontRegardless()
win.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)

let urlString = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "http://127.0.0.1:7433/bench/latency.html"
webView.load(URLRequest(url: URL(string: urlString)!))

DispatchQueue.main.asyncAfter(deadline: .now() + 120) {
    FileHandle.standardError.write(Data("bench timeout after 120s\n".utf8))
    exit(2)
}
app.run()
