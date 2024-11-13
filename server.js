const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

axios.defaults.timeout = 5000;

const app = express();
app.use(bodyParser.json());

const PORT = 3000;

// LinkedIn App Config
const linkedinConfig = {
  clientId: "",
  clientSecret: "",
  redirectUri: "http://localhost:3000/linkedin/callback",
};

// Scopes for authentication
const SCOPES =
  "openid,profile,email,rw_organization_admin,r_basicprofile,w_organization_social,r_organization_social";

// Helper: Get Access Token
const getAccessToken = async (code, redirectUri) => {
  const tokenUrl = "https://www.linkedin.com/oauth/v2/accessToken";

  const params = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: linkedinConfig.clientId,
    client_secret: linkedinConfig.clientSecret,
  };

  try {
    const response = await axios.post(tokenUrl, null, { params });
    return response.data.access_token;
  } catch (error) {
    throw new Error(
      `Error fetching access token: ${error.response?.data || error.message}`
    );
  }
};

// Helper: Get User Profile
const getUserProfile = async (accessToken) => {
  try {
    const response = await axios.get("https://api.linkedin.com/v2/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  } catch (error) {
    throw new Error(
      `Error fetching user profile: ${error.response?.data || error.message}`
    );
  }
};

// Helper: Get User's LinkedIn Pages
const getUserPages = async (accessToken) => {
  try {
    const response = await axios.get(
      "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    return response.data.elements;
  } catch (error) {
    throw new Error(
      `Error fetching LinkedIn pages: ${error.response?.data || error.message}`
    );
  }
};

// Helper: Post on LinkedIn Page
const postOnLinkedInPage = async (accessToken, orgId, text) => {
  const postData = {
    author: `urn:li:organization:${orgId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: {
          text,
        },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  try {
    const response = await axios.post(
      "https://api.linkedin.com/v2/ugcPosts",
      postData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    throw new Error(
      `Error posting on LinkedIn: ${error.response?.data || error.message}`
    );
  }
};

// Route: Start LinkedIn Authentication
app.get("/", (req, res) => {
  const csrfState = Math.random().toString(36).substring(2); // Generate CSRF state
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${linkedinConfig.clientId}&redirect_uri=${linkedinConfig.redirectUri}&scope=${SCOPES}&state=${csrfState}`;
  res.redirect(authUrl);
});

// Route: Handle LinkedIn Callback
app.get("/linkedin/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send("Code not provided");
  }

  try {
    const accessToken = await getAccessToken(code, linkedinConfig.redirectUri);

    const userProfile = await getUserProfile(accessToken);
    const pages = await getUserPages(accessToken);

    if (pages.length === 0) {
      return res.send("No pages found for this user.");
    }

    const organization = pages[0].organization.split(":").pop(); // Use the first organization
    const postResponse = await postOnLinkedInPage(
      accessToken,
      organization,
      "Hello from LinkedIn API!"
    );

    res.json({
      message: "Post created successfully!",
      userProfile,
      postResponse,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).send(error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
