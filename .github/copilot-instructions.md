# GitHub Copilot Instructions for Modern Chrome Extension

## Project Overview
This is a modern Chrome extension project following Manifest V3 specifications and best practices.

## Code Style and Conventions

### General Guidelines
- Use modern JavaScript (ES6+) or TypeScript for all code
- Follow consistent naming conventions: camelCase for variables/functions, PascalCase for classes
- Use async/await for asynchronous operations instead of callbacks
- Implement proper error handling with try-catch blocks
- Add JSDoc or TSDoc comments for functions and classes

### Chrome Extension Specific
- Always target Manifest V3 (not Manifest V2)
- Use service workers instead of background pages
- Prefer declarativeNetRequest over webRequest where possible
- Use chrome.storage.local or chrome.storage.sync for persistence
- Implement proper permissions with minimal scope

## Architecture Patterns

### File Structure
```
extension/
├── manifest.json          # Extension manifest (V3)
├── background/
│   └── service-worker.js  # Background service worker
├── content/
│   └── content-script.js  # Content scripts
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
└── assets/
    └── icons/
```

### Service Workers
- Keep service workers lightweight and event-driven
- Avoid long-running operations
- Use alarms API for periodic tasks
- Properly handle service worker lifecycle events

### Content Scripts
- Minimize DOM manipulation overhead
- Use message passing to communicate with service worker
- Isolate CSS to avoid conflicts with page styles
- Be mindful of website CSP policies

### Message Passing
- Use chrome.runtime.sendMessage for one-time requests
- Use chrome.runtime.connect for long-lived connections
- Always validate messages from untrusted contexts
- Implement proper error handling for disconnected ports

## Security Best Practices

### Content Security Policy
- Define strict CSP in manifest.json
- Avoid inline scripts and eval()
- Load external resources only from trusted sources
- Use nonce or hash for inline scripts if necessary

### Permissions
- Request minimum permissions required
- Use optional permissions for features not core to extension
- Document why each permission is needed
- Consider host permissions carefully

### Data Handling
- Sanitize all user inputs
- Validate data from external sources
- Use chrome.storage API instead of localStorage
- Never store sensitive data in plaintext

## Modern Chrome APIs

### Preferred APIs
- `chrome.action` (replaces browserAction/pageAction)
- `chrome.declarativeNetRequest` (replaces webRequest)
- `chrome.scripting` for dynamic content script injection
- `chrome.storage` for data persistence
- `chrome.alarms` for periodic tasks

### API Usage Patterns
- Always check for API availability before use
- Handle promise rejections from chrome APIs
- Use optional chaining when accessing nested properties
- Implement fallbacks for unsupported features

## Testing and Quality

### Testing Approach
- Write unit tests for business logic
- Test message passing between components
- Validate manifest.json structure
- Test across different Chrome versions
- Test permissions and security boundaries

### Code Quality
- Use ESLint with chrome extension rules
- Implement TypeScript for type safety
- Run Prettier for consistent formatting
- Use Chrome Extension Manifest validator

## Development Workflow

### Build Process
- Use bundlers (Webpack, Rollup, Vite) for modern JavaScript
- Implement hot reload for development
- Minify and optimize for production
- Generate source maps for debugging

### Debugging
- Use chrome://extensions developer mode
- Leverage Chrome DevTools for debugging
- Check service worker console separately
- Monitor chrome.runtime.lastError

## Performance Optimization

### Best Practices
- Lazy load resources when possible
- Debounce/throttle frequent operations
- Use chrome.storage efficiently (batch operations)
- Minimize memory footprint in service workers
- Optimize content script injection timing

## Accessibility

### Guidelines
- Ensure popup and options pages are keyboard accessible
- Provide proper ARIA labels and roles
- Support high contrast mode
- Test with screen readers
- Provide clear error messages and feedback

## Documentation

### Code Documentation
- Document complex logic and algorithms
- Explain Chrome API usage patterns
- Note browser version requirements
- Document message passing protocols
- Include examples for common tasks

### User Documentation
- Provide clear README with setup instructions
- Document all features and keyboard shortcuts
- Include troubleshooting guide
- Explain permission requirements

## Common Patterns

### Storage Management
```javascript
// Save data
await chrome.storage.local.set({ key: value });

// Get data
const result = await chrome.storage.local.get('key');
```

### Message Passing
```javascript
// Send message (async/await pattern)
async function sendMessageExample() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getData' });
    console.log('Received:', response.data);
  } catch (error) {
    console.error('Message failed:', error);
  }
}

// Receive message (async handler)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getData') {
    // For async operations, return true and use Promise
    (async () => {
      try {
        const data = await fetchDataAsync();
        sendResponse({ data });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else if (message.action === 'getImmediateValue') {
    // For sync responses, no need to return true
    sendResponse({ data: 'immediate value' });
  }
});
```

### Content Script Injection
```javascript
// Dynamic injection
await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  files: ['content-script.js']
});
```

## Migration from V2 to V3

When suggesting code or patterns:
- Replace background.page/scripts with background.service_worker
- Use action instead of browser_action or page_action
- Replace webRequest with declarativeNetRequest where applicable
- Update CSP format to V3 specification
- Use host_permissions instead of permissions for URLs

## Additional Resources
- Chrome Extension Documentation: https://developer.chrome.com/docs/extensions/
- Manifest V3 Migration Guide: https://developer.chrome.com/docs/extensions/mv3/intro/
- Chrome Extension Samples: https://github.com/GoogleChrome/chrome-extensions-samples
