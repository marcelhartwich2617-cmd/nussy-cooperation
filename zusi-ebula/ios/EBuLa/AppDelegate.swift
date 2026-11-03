import UIKit

/// Nussy EBuLa – iOS-App. Zeigt die Fahrplananzeige (public/index.html) im Vollbild
/// und verbindet sich über das WLAN mit der Bridge auf dem Zusi-PC.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Bildschirm bleibt an, solange die EBuLa läuft
        application.isIdleTimerDisabled = true
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = .black
        window.rootViewController = EBuLaViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
