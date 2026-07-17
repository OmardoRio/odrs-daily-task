const fs = require('fs');
const path = require('path');
const http = require('http');
const { shell } = require('electron');
const { OAuth2Client } = require('google-auth-library');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

class GoogleCalendarClient {
  constructor(userDataPath) {
    this.credentialsPath = path.join(userDataPath, 'google-credentials.json');
    this.tokenPath = path.join(userDataPath, 'google-tokens.json');
  }

  hasCredentials() {
    return fs.existsSync(this.credentialsPath);
  }

  isConnected() {
    return fs.existsSync(this.tokenPath);
  }

  // Only one Google account can be connected per install at a time - this
  // just drops the stored token so the next "Conectar Google Agenda..."
  // goes through Google's consent screen fresh (where the user can pick a
  // different account).
  disconnect() {
    if (fs.existsSync(this.tokenPath)) {
      fs.unlinkSync(this.tokenPath);
    }
  }

  _loadCredentials() {
    const { client_id, client_secret } = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));
    if (!client_id || !client_secret) {
      throw new Error("google-credentials.json precisa conter 'client_id' e 'client_secret'");
    }
    return { client_id, client_secret };
  }

  _saveTokens(tokens) {
    fs.writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2), 'utf-8');
  }

  _loadTokens() {
    return JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
  }

  // One-time consent flow: opens the system browser, catches the redirect on
  // a throwaway local server, and stores the refresh token for future syncs.
  connect() {
    const { client_id, client_secret } = this._loadCredentials();

    return new Promise((resolve, reject) => {
      let oauth2Client;

      const server = http.createServer((req, res) => {
        (async () => {
          try {
            const url = new URL(req.url, 'http://127.0.0.1');
            const code = url.searchParams.get('code');
            if (!code) {
              res.end('Não recebi o código de autorização. Pode fechar esta aba e tentar de novo.');
              return;
            }
            const { tokens } = await oauth2Client.getToken(code);
            this._saveTokens(tokens);
            res.end("Google Agenda conectado! Pode fechar esta aba e voltar para o ODR's Daily Task.");
            server.close();
            resolve();
          } catch (err) {
            res.end('Falha ao conectar. Pode fechar esta aba e tentar de novo.');
            server.close();
            reject(err);
          }
        })();
      });

      server.on('error', reject);

      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        oauth2Client = new OAuth2Client(client_id, client_secret, `http://127.0.0.1:${port}/oauth2callback`);
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: SCOPES,
        });
        shell.openExternal(authUrl);
      });
    });
  }

  async _getAccessToken() {
    const { client_id, client_secret } = this._loadCredentials();
    const client = new OAuth2Client(client_id, client_secret);
    client.setCredentials(this._loadTokens());
    // google-auth-library refreshes the access token under the hood using
    // the stored refresh_token; persist whatever it hands back so the next
    // sync doesn't need a fresh round-trip.
    client.on('tokens', (tokens) => {
      this._saveTokens({ ...this._loadTokens(), ...tokens });
    });
    const { token } = await client.getAccessToken();
    return token;
  }

  // Only today's events (00:00-23:59 local time) - the same "today only,
  // nothing from yesterday or tomorrow" rule the manual checklist follows.
  async fetchTodayEvents() {
    if (!this.hasCredentials() || !this.isConnected()) return [];

    const accessToken = await this._getAccessToken();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const params = new URLSearchParams({
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) {
      throw new Error(`Google Calendar API respondeu ${response.status}`);
    }
    const data = await response.json();

    return (data.items || [])
      .filter((event) => event.status !== 'cancelled')
      .map((event) => ({
        id: event.id,
        text: event.summary || '(sem título)',
      }));
  }
}

module.exports = { GoogleCalendarClient };
