import UIKit
import WebKit

final class EBuLaViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private let haptic = UIImpactFeedbackGenerator(style: .medium)

    override func loadView() {
        let config = WKWebViewConfiguration()
        // Die Seite kommt aus dem App-Paket über ein eigenes Schema (wie bei Capacitor),
        // damit localStorage funktioniert und die Bridge per http erreichbar ist.
        config.setURLSchemeHandler(AppSchemeHandler(root: Bundle.main.resourceURL!.appendingPathComponent("public")), forURLScheme: "ebula")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "NussyEBuLa/1.0"
        // Gleiche Schnittstelle wie in der Android-App (window.NussyApp)
        config.userContentController.addUserScript(WKUserScript(
            source: """
            window.NussyApp = {
              getLocalIp: function () { return \(jsString(Self.localWifiAddress())); },
              startPage: function () { return 'index.html'; },
              version: function () { return '1.0'; },
              vibrate: function (ms) { window.webkit.messageHandlers.vibrate.postMessage(String(ms)); }
            };
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(self, name: "vibrate")

        web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.uiDelegate = self
        web.navigationDelegate = self
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.load(URLRequest(url: URL(string: "ebula://app/index.html")!))
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    // Links nach außen im Browser öffnen
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme == "http" || url.scheme == "https", action.targetFrame?.isMainFrame != false {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // Haptische Rückmeldung für Tasten und Meldungen (iOS hat kein navigator.vibrate)
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "vibrate" else { return }
        haptic.impactOccurred()
    }

    // Seite neu laden, falls iOS den WebView-Prozess beendet hat
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // JavaScript-Dialoge (alert/confirm) als iOS-Dialoge anzeigen
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Abbrechen", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    /// IPv4-Adresse im WLAN (en0), damit die Anzeige das passende Netz nach der Bridge durchsuchen kann.
    private static func localWifiAddress() -> String? {
        var result: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }
        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = ptr.pointee
            guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: ifa.ifa_name)
            guard name.hasPrefix("en") || name.hasPrefix("bridge") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                let ip = String(cString: host)
                if name == "en0" { return ip }
                if result == nil { result = ip }
            }
        }
        return result
    }

    private func jsString(_ s: String?) -> String {
        guard let s = s else { return "null" }
        return "'" + s.replacingOccurrences(of: "'", with: "") + "'"
    }
}

/// Liefert die Dateien der Anzeige aus dem App-Paket unter ebula://app/…
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
            task.didFinish()
            return
        }
        let types = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "png": "image/png",
                     "svg": "image/svg+xml", "webmanifest": "application/manifest+json", "xml": "application/xml",
                     "json": "application/json", "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg", "m4a": "audio/mp4"]
        let headers = ["Content-Type": types[file.pathExtension.lowercased()] ?? "application/octet-stream",
                       "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
