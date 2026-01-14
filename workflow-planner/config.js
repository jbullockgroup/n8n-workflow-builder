// Configuration - SECURITY UPDATE
// API keys are now managed server-side only and are NOT exposed to the browser.
// This file is kept for any future non-sensitive client-side configuration.

class Config {
    constructor() {
        console.log('✅ Config initialized - API keys are managed server-side');
    }

    // Note: API keys are no longer available client-side.
    // All API calls go through the proxy server which handles authentication.
}

// Initialize configuration
const config = new Config();
window.AppConfig = config;
