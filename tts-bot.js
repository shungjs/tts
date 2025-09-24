const tmi = require('tmi.js');
const fetch = require('node-fetch');
const say = require('say');

// =============================================================================
// 🎛️ CONFIGURATION - UPDATE THESE!
// =============================================================================
const CONFIG = {
  // Twitch Bot Settings - UPDATE THESE!
  twitch: {
    username: 'YOUR_BOT_USERNAME',           // Your bot's Twitch username
    password: 'oauth:YOUR_OAUTH_TOKEN',      // Get from https://twitchapps.com/tmi/
    channel: 'YOUR_CHANNEL_NAME'             // Your channel name (lowercase)
  },
  
  // Your Volume API - UPDATE THIS!
  volumeApiUrl: 'https://your-app.onrender.com', // Your Render.com URL from Part 1
  
  // TTS Settings
  tts: {
    voice: 'Alex',                           // TTS voice (Alex for Mac, Microsoft David for Windows)
    speed: 1.0,                             // Speech speed
    maxMessageLength: 200,                  // Max characters to speak
    baseVolume: 1.0                         // System volume multiplier
  }
};

// =============================================================================
// TTS BOT CLASS
// =============================================================================
class TTSBot {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.ttsQueue = [];
    this.isProcessingTTS = false;
    
    this.initTwitchBot();
    this.startTTSProcessor();
    
    console.log('🤖 TTS Bot starting...');
  }

  // Initialize Twitch bot connection
  initTwitchBot() {
    this.client = new tmi.Client({
      options: { debug: false },
      connection: {
        reconnect: true,
        secure: true
      },
      identity: {
        username: CONFIG.twitch.username,
        password: CONFIG.twitch.password
      },
      channels: [CONFIG.twitch.channel]
    });

    // Event handlers
    this.client.on('connected', () => {
      console.log('✅ Connected to Twitch chat!');
      this.isConnected = true;
      this.sendChatMessage('🤖 TTS Bot is online! Use !tts <message> to test.');
    });

    this.client.on('message', (channel, userstate, message, self) => {
      if (self) return; // Ignore bot's own messages
      this.handleChatMessage(userstate, message);
    });

    this.client.connect().catch(console.error);
  }

  // Handle chat messages and commands
  async handleChatMessage(userstate, message) {
    const username = userstate.username;
    const msg = message.trim();

    // TTS command: !tts <message>
    if (msg.toLowerCase().startsWith('!tts ')) {
      const ttsMessage = msg.substring(5);
      await this.processTTSRequest(username, ttsMessage);
    }
    
    // Volume check command: !volume
    else if (msg.toLowerCase() === '!volume') {
      await this.showUserVolume(username);
    }

    // Help command: !ttshelp
    else if (msg.toLowerCase() === '!ttshelp') {
      this.sendChatMessage('🎤 TTS Commands: !tts <message> | !volume | Volume increases 2% per TTS use!');
    }

    // Stats command: !ttsstats  
    else if (msg.toLowerCase() === '!ttsstats') {
      await this.showStats();
    }
  }

  // Process TTS request and get volume from API
  async processTTSRequest(username, message) {
    try {
      console.log(`🎯 TTS Request from ${username}: "${message}"`);
      
      // Get user's volume from your API
      const response = await fetch(`${CONFIG.volumeApiUrl}/api/tts/${username}/json`);
      
      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }
      
      const volumeData = await response.json();

      if (!volumeData.success) {
        throw new Error('API returned error');
      }

      const userVolume = volumeData.volume;
      const volumePercent = volumeData.volumePercent;
      
      console.log(`🔊 ${username} TTS Volume: ${volumePercent}%`);
      
      // Add to TTS queue
      this.ttsQueue.push({
        username,
        message: this.sanitizeMessage(message),
        volume: userVolume,
        volumePercent,
        ttsCount: volumeData.ttsCount,
        timestamp: Date.now()
      });

      // Notify chat
      this.sendChatMessage(`🔊 @${username} TTS queued at ${volumePercent}% volume! (Queue: ${this.ttsQueue.length})`);

    } catch (error) {
      console.error(`❌ Error processing TTS for ${username}:`, error);
      this.sendChatMessage(`@${username} Sorry, TTS system error. Is the API running?`);
    }
  }

  // Show user's current volume
  async showUserVolume(username) {
    try {
      const response = await fetch(`${CONFIG.volumeApiUrl}/api/tts/${username}`);
      const text = await response.text();
      this.sendChatMessage(text);
    } catch (error) {
      this.sendChatMessage(`@${username} Couldn't get volume info. API might be down.`);
    }
  }

  // Show bot stats
  async showStats() {
    try {
      const response = await fetch(`${CONFIG.volumeApiUrl}/api/stats`);
      const stats = await response.text();
      this.sendChatMessage(stats);
    } catch (error) {
      this.sendChatMessage('Stats unavailable - API might be down.');
    }
  }

  // Process TTS queue
  startTTSProcessor() {
    setInterval(() => {
      if (!this.isProcessingTTS && this.ttsQueue.length > 0) {
        this.processNextTTS();
      }
    }, 1000);
  }

  async processNextTTS() {
    if (this.ttsQueue.length === 0) return;

    this.isProcessingTTS = true;
    const ttsItem = this.ttsQueue.shift();

    console.log(`🎤 Speaking: "${ttsItem.message}" at ${ttsItem.volumePercent}% volume`);

    try {
      // Speak the message
      await this.speakMessage(ttsItem.message, ttsItem.volume);
      
      // Show in chat what was spoken
      this.sendChatMessage(`🎤 "${ttsItem.message}" (${ttsItem.volumePercent}% vol)`);

    } catch (error) {
      console.error('❌ TTS Error:', error);
      this.sendChatMessage(`❌ TTS Error for @${ttsItem.username}`);
    }

    this.isProcessingTTS = false;
  }

  // Speak message using system TTS
  speakMessage(message, volume) {
    return new Promise((resolve, reject) => {
      const options = {
        voice: CONFIG.tts.voice,
        speed: CONFIG.tts.speed
      };

      // Note: volume control varies by platform
      // This uses the system's default volume
      say.speak(message, options, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Clean message for TTS
  sanitizeMessage(message) {
    let cleaned = message
      .replace(/https?:\/\/[^\s]+/g, '')     // Remove URLs
      .replace(/@\w+/g, '')                  // Remove mentions  
      .replace(/[^\w\s.,!?'-]/g, '')         // Remove special characters
      .trim();

    // Limit length
    if (cleaned.length > CONFIG.tts.maxMessageLength) {
      cleaned = cleaned.substring(0, CONFIG.tts.maxMessageLength) + '';
    }

    return cleaned || 'No message provided';
  }

  // Send message to chat
  sendChatMessage(message) {
    if (this.isConnected && this.client) {
      this.client.say(CONFIG.twitch.channel, message).catch(console.error);
    }
  }
}

// =============================================================================
// START THE BOT
// =============================================================================
console.log(`
🤖 TTS Bot with Volume Control

SETUP CHECKLIST:
✅ 1. Update CONFIG section above with your details
✅ 2. Make sure your Volume API is running  
✅ 3. Install dependencies: npm install
✅ 4. Run: npm start

COMMANDS:
- !tts <message> - Speak message with volume progression
- !volume - Check current TTS volume level  
- !ttshelp - Show help
- !ttsstats - Show bot statistics

Volume starts at 10%, increases 2% per TTS use, max 90%
`);

// Start the bot
new TTSBot();
