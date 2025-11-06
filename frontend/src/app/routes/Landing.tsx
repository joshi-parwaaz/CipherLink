import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import LetterGlitch from '../../components/effects/LetterGlitch';

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const titleWords = "Cipher Link".split(" ");
  const subtitle = "End-to-end encrypted messaging. Zero-access architecture.";
  const [visibleWords, setVisibleWords] = useState(0);
  const [subtitleVisible, setSubtitleVisible] = useState(false);

  useEffect(() => {
    if (visibleWords < titleWords.length) {
      const timeout = setTimeout(() => setVisibleWords(visibleWords + 1), 150);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => setSubtitleVisible(true), 200);
      return () => clearTimeout(timeout);
    }
  }, [visibleWords, titleWords.length]);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-[9999] bg-black/95 backdrop-blur-md border-b border-green-500/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex-shrink-0">
              <h1 className="text-xl font-bold tracking-wider uppercase">
                Cipher<span className="text-green-500">Link</span>
              </h1>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-white hover:text-green-500 transition-colors duration-200">
                Features
              </a>
              <a href="#security" className="text-white hover:text-green-500 transition-colors duration-200">
                Security
              </a>
              <a href="#technology" className="text-white hover:text-green-500 transition-colors duration-200">
                Technology
              </a>
              <Link
                to="/signin"
                className="text-white hover:text-green-500 transition-colors duration-200"
              >
                Sign In
              </Link>
              <Link
                to="/signup"
                className="px-6 py-2 bg-green-500 hover:bg-green-600 text-black font-semibold transition-colors duration-200 rounded"
              >
                Get Started
              </Link>
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="text-white hover:text-green-500 transition-colors duration-200"
              >
                {mobileMenuOpen ? (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-green-500/20 py-4">
              <div className="flex flex-col space-y-4">
                <a href="#features" className="text-white hover:text-green-500 transition-colors duration-200">
                  Features
                </a>
                <a href="#security" className="text-white hover:text-green-500 transition-colors duration-200">
                  Security
                </a>
                <a href="#technology" className="text-white hover:text-green-500 transition-colors duration-200">
                  Technology
                </a>
                <Link to="/signin" className="text-white hover:text-green-500 transition-colors duration-200">
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="px-6 py-2 bg-green-500 hover:bg-green-600 text-black font-semibold transition-colors duration-200 rounded text-center"
                >
                  Get Started
                </Link>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section with Matrix Letter Glitch */}
      <section className="relative h-screen overflow-hidden">
        <div className="absolute inset-0">
          <LetterGlitch 
            glitchColors={['#0a4d2e', '#0f7544', '#1a5c3f']}
            glitchSpeed={30}
            outerVignette={true}
            centerVignette={false}
            smooth={true}
          />
        </div>

        {/* Title overlay */}
        <div className="absolute inset-0 z-60 pointer-events-none px-10 flex justify-center flex-col items-center">
          <div className="text-3xl md:text-5xl xl:text-6xl 2xl:text-7xl font-extrabold uppercase tracking-wider">
            <div className="flex space-x-2 lg:space-x-6 overflow-hidden text-white">
              {titleWords.map((word, index) => (
                <div
                  key={index}
                  className={`transition-opacity duration-1000 ${
                    index < visibleWords ? 'opacity-100 animate-fade-in' : 'opacity-0'
                  }`}
                  style={{
                    animationDelay: `${index * 0.05}s`,
                  }}
                >
                  {word}
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs md:text-xl xl:text-2xl 2xl:text-3xl mt-4 overflow-hidden text-white font-semibold max-w-4xl mx-auto text-center px-4">
            <div
              className={`transition-opacity duration-1000 ${
                subtitleVisible ? 'opacity-100 animate-fade-in-up' : 'opacity-0'
              }`}
              style={{
                animationDelay: `${titleWords.length * 0.05 + 0.1}s`,
              }}
            >
              {subtitle}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6 bg-black">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">Next-Generation Security</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Military-grade encryption that protects your conversations
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "E2E Encryption",
                description: "XChaCha20-Poly1305 AEAD with Double Ratchet protocol for perfect forward secrecy.",
                icon: "🔐",
                badge: "Secure",
              },
              {
                title: "Zero-Access",
                description: "Your keys, your data. We mathematically cannot decrypt your messages.",
                icon: "🔒",
                badge: "Private",
              },
              {
                title: "X3DH Handshake",
                description: "Extended Triple Diffie-Hellman for secure initial key exchange.",
                icon: "🤝",
                badge: "Protocol",
              },
              {
                title: "Multi-Device",
                description: "Seamlessly sync encrypted messages across all your devices.",
                icon: "📱",
                badge: "Sync",
              },
              {
                title: "File Encryption",
                description: "Send photos, videos, and files with end-to-end encryption.",
                icon: "📎",
                badge: "Secure",
              },
              {
                title: "Safety Numbers",
                description: "Verify contacts through cryptographic fingerprints and QR codes.",
                icon: "🔍",
                badge: "Verified",
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="border border-green-500/20 hover:border-green-500/50 bg-black hover:bg-green-500/5 p-6 rounded-lg transition-all duration-300 group"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-4xl">{feature.icon}</span>
                  <span className="text-xs px-3 py-1 bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                    {feature.badge}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-green-400 transition-colors">
                  {feature.title}
                </h3>
                <p className="text-gray-400 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="py-24 px-6 bg-black border-t border-green-500/20">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                <span className="text-green-500">Zero-Knowledge</span> Architecture
              </h2>
              <div className="space-y-6 text-lg text-gray-300">
                <div className="flex items-start space-x-4">
                  <div className="text-green-500 text-2xl flex-shrink-0">✓</div>
                  <div>
                    <h3 className="font-bold mb-1 text-white">Client-Side Encryption Only</h3>
                    <p className="text-gray-400">
                      All encryption happens on your device. Server only stores encrypted envelopes.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <div className="text-green-500 text-2xl flex-shrink-0">✓</div>
                  <div>
                    <h3 className="font-bold mb-1 text-white">Metadata-Only Logging</h3>
                    <p className="text-gray-400">
                      We only log connection timestamps, never message content or metadata.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <div className="text-green-500 text-2xl flex-shrink-0">✓</div>
                  <div>
                    <h3 className="font-bold mb-1 text-white">Audited Cryptography</h3>
                    <p className="text-gray-400">
                      Using battle-tested libsodium with XChaCha20-Poly1305 AEAD cipher.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <div className="text-green-500 text-2xl flex-shrink-0">✓</div>
                  <div>
                    <h3 className="font-bold mb-1 text-white">No Backdoors. Ever.</h3>
                    <p className="text-gray-400">
                      Mathematical impossibility for anyone to decrypt your messages.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="relative">
              <div className="aspect-square border border-green-500/30 rounded-lg p-12 flex items-center justify-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="text-center relative z-10">
                  <div className="text-8xl mb-4 animate-pulse-slow">🛡️</div>
                  <h3 className="text-2xl font-bold text-green-400 uppercase tracking-wider">Military-Grade</h3>
                  <p className="text-gray-400 mt-2">Encryption Standards</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Technology Section */}
      <section id="technology" className="py-24 px-6 bg-black border-t border-green-500/20">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Built on <span className="text-green-500">Open Standards</span>
          </h2>
          <p className="text-xl text-gray-300 mb-8">
            CipherLink implements the same protocols used by security professionals worldwide.
            Our zero-access architecture ensures complete privacy—we can't read your messages even if we wanted to.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-12">
            {['X3DH', 'Double Ratchet', 'XChaCha20', 'Ed25519'].map((tech, index) => (
              <div
                key={index}
                className="border border-green-500/30 bg-green-500/5 p-6 rounded-lg hover:border-green-500/60 transition-all"
              >
                <div className="text-2xl font-bold text-green-400 uppercase tracking-wider">{tech}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6 bg-black border-t border-green-500/20">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Start Messaging <span className="text-green-500">Securely</span>
          </h2>
          <p className="text-xl text-gray-300 mb-8">
            Join thousands protecting their conversations with CipherLink.
          </p>
          <Link
            to="/signup"
            className="inline-block px-12 py-4 bg-green-500 hover:bg-green-600 text-black text-xl font-bold transition-all transform hover:scale-105 rounded uppercase tracking-wider"
          >
            Get Started
          </Link>
          <p className="mt-6 text-gray-500 text-sm">
            Free forever • End-to-end encrypted • Zero-access architecture
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-green-500/20 py-12 bg-black">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-xl font-bold mb-4 uppercase tracking-wider">
                Cipher<span className="text-green-500">Link</span>
              </h3>
              <p className="text-gray-400 text-sm">
                Private messaging for everyone.
              </p>
            </div>
            <div>
              <h4 className="font-bold mb-4 text-white">Product</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li>
                  <a href="#features" className="hover:text-green-500 transition-colors">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#security" className="hover:text-green-500 transition-colors">
                    Security
                  </a>
                </li>
                <li>
                  <a href="#technology" className="hover:text-green-500 transition-colors">
                    Technology
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4 text-white">Resources</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li>
                  <a href="#" className="hover:text-green-500 transition-colors">
                    Documentation
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-green-500 transition-colors">
                    GitHub
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-green-500 transition-colors">
                    Security Audit
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4 text-white">Legal</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li>
                  <a href="#" className="hover:text-green-500 transition-colors">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-green-500 transition-colors">
                    Terms of Service
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-green-500/20 text-center text-gray-500 text-sm">
            <p>© 2025 CipherLink. Built with privacy in mind.</p>
            <p className="mt-2">🔒 End-to-end encrypted • Zero-access architecture</p>
          </div>
        </div>
      </footer>

      {/* CSS Animations */}
      <style>{`
        @keyframes scan-line {
          0% { transform: translateY(-100vh); }
          100% { transform: translateY(100vh); }
        }
        
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        
        @keyframes pulse-slower {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.1); }
        }
        
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes spin-slower-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-scan-line {
          animation: scan-line 8s linear infinite;
        }
        
        .animate-pulse-slow {
          animation: pulse-slow 4s ease-in-out infinite;
        }
        
        .animate-pulse-slower {
          animation: pulse-slower 6s ease-in-out infinite;
        }
        
        .animate-spin-slow {
          animation: spin-slow 20s linear infinite;
        }
        
        .animate-spin-slower-reverse {
          animation: spin-slower-reverse 30s linear infinite;
        }
        
        .animate-fade-in {
          animation: fade-in 1s ease-out forwards;
        }
        
        .animate-fade-in-up {
          animation: fade-in-up 1s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
