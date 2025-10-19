import { GoogleAuth } from 'google-auth-library';
import type { Credentials } from 'google-auth-library';
import dotenv from 'dotenv';

const TOKEN_EXPIRY_TIME = 30 * 60 * 1000; // 30 min

dotenv.config();

class GoogleGcloudAuth {
    private googleAuth: GoogleAuth;
    private credentials: Credentials | null = null;
    private tokenExpiry: number = 0;

    constructor() {
        // Try base64 encoded key first, then fall back to direct JSON
        const serviceAccountKeyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;

        let serviceAccountKey;

        if (serviceAccountKeyBase64) {
            try {
                const decodedJson = Buffer.from(serviceAccountKeyBase64, 'base64').toString('utf8');
                serviceAccountKey = JSON.parse(decodedJson);
            } catch (error) {
                throw new Error('Invalid base64 or JSON in GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 environment variable');
            }
        } else {
            throw new Error('Either GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 environment variable is required');
        }

        // Initialize GoogleAuth with service account credentials
        this.googleAuth = new GoogleAuth({
            credentials: serviceAccountKey,
            scopes: [
                'https://www.googleapis.com/auth/generative-language',
                'https://www.googleapis.com/auth/cloud-platform',
            ],
        });
    }

    /**
     * Refresh token using service account credentials
     * Equivalent to Python: credentials.refresh(request)
     */
    async refreshToken(): Promise<string> {
        try {
            const client = await this.googleAuth.getClient();
            const tokenResponse = await client.getAccessToken();

            if (!tokenResponse.token) {
                throw new Error('Failed to get access token from service account');
            }

            // Get the credentials information from the client
            // Using type assertion as the credentials property is not exposed in the type definition
            const credentialsInfo = (client as { credentials?: Credentials }).credentials;
            this.credentials = credentialsInfo || null;

            // Set token expiry (Google tokens typically expire in 1 hour)
            const expiryTime = credentialsInfo?.expiry_date
                ? credentialsInfo.expiry_date
                : Date.now() + TOKEN_EXPIRY_TIME;

            this.tokenExpiry = expiryTime;

            return tokenResponse.token;
        } catch (error) {
            console.error('❌ Error refreshing Google token:', error);
            throw error;
        }
    }

    /**
     * Get valid token, refreshing if necessary
     */
    async getValidToken(): Promise<string> {
        // Check if token is still valid (refresh 5 minutes before expiry)
        const now = Date.now();
        if (this.credentials?.access_token && this.tokenExpiry > now + 5 * 60 * 1000) {
            return this.credentials.access_token;
        }

        return await this.refreshToken();
    }
}

// Singleton instance
export const googleGcloudAuth = new GoogleGcloudAuth();