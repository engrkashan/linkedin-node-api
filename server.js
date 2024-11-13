const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const multer = require("multer");

const upload = multer({ dest: "uploads/" });

axios.defaults.timeout = 5000;

const app = express();
app.use(bodyParser.json());

const PORT = 3000;

// LinkedIn App Config
const linkedinConfig = {

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
      timeout: 10000,
      family: 4,
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
        timeout: 10000,
        family: 4,
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
const uploadFileToLinkedIn = async (accessToken, orgId, filePath, fileName) => {
  const registerUploadUrl =
    "https://api.linkedin.com/rest/assets?action=registerUpload";

  const registerPayload = {
    registerUploadRequest: {
      owner: `urn:li:organization:${orgId}`,
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      serviceRelationships: [
        {
          identifier: "urn:li:userGeneratedContent",
          relationshipType: "OWNER",
        },
      ],
      supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
    },
  };
  try {
    const registerResponse = await axios.post(
      registerUploadUrl,
      registerPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const uploadUrl =
      registerResponse.data.value.uploadMechanism[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
      ].uploadUrl;
    const asset = registerResponse.data.value.asset;

    console.log("uploadUrl", uploadUrl);

    // Step 2: Upload the file to the upload URL
    const fs = require("fs");
    const fileStream = fs.createReadStream(filePath);

    const uploadResponse = await axios.put(uploadUrl, fileStream, {
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });

    console.log("Upload Response:", uploadResponse.data);

    return asset; // Return the asset ID to include in the post
  } catch (error) {
    console.error(
      "Error Response from LinkedIn API:",
      error.response?.data || error.message
    );
    throw new Error(
      `Error uploading file: ${error.response?.data || error.message}`
    );
  }
};

const postOnLinkedInPage = async (accessToken, orgId, text, asset) => {
  const postData = {
    author: `urn:li:organization:${orgId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: asset ? "IMAGE" : "NONE",
        media: asset ? [{ status: "READY", media: asset }] : [],
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  try {
    console.log("Request Payload:", JSON.stringify(postData, null, 2));

    const response = await axios.post(
      "https://api.linkedin.com/v2/ugcPosts",
      postData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
        family: 4,
      }
    );

    console.log("Response Data:", response.data);
    return response.data;
  } catch (error) {
    console.error("Error Response:", error.response?.data || error.message);
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
    console.log(accessToken);

    const userProfile = await getUserProfile(accessToken);
    const pages = await getUserPages(accessToken);

    if (pages.length === 0) {
      return res.send("No pages found for this user.");
    }

    // Return the list of pages to the user for selection
    res.json({
      message: "Select an organization to post to.",
      userProfile,
      pages: pages.map((page) => ({
        id: page.organization.split(":").pop(), // Extract the organization ID
        name: page.organization, // Add additional information if needed
      })),
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).send(error.message);
  }
});

// Route: Post on selected LinkedIn Page
app.post("/linkedin/post", upload.single("file"), async (req, res) => {
  console.log("Uploaded File:", req.file);

  const { accessToken, orgId, text } = req.body;
  const file = req.file;

  if (!accessToken || !orgId || !text) {
    return res
      .status(400)
      .send("Access token, organization ID, and text are required.");
  }

  try {
    let asset = null;

    if (file) {
      console.log("Uploading file to LinkedIn:", file.path);
      asset = await uploadFileToLinkedIn(
        accessToken,
        orgId,
        file.path,
        file.originalname
      );
    }

    const postResponse = await postOnLinkedInPage(
      accessToken,
      orgId,
      text,
      asset
    );

    res.json({
      message: "Post created successfully!",
      postResponse,
    });
  } catch (error) {
    console.error("Error Details:", error.response?.data || error.message);
    res.status(500).json({
      error: "Error posting on LinkedIn",
      details: error.response?.data || error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
