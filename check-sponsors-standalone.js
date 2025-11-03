#!/usr/bin/env node

/**
 * Standalone Sponsor Validation Script
 * No external dependencies - uses only Node.js built-ins
 *
 * Usage: node check-sponsors-standalone.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// Import constants from external file
const GRID_SLUGS = require("./constants-grid.js");

// Simple .env file parser
function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, ".env");
    const envContent = fs.readFileSync(envPath, "utf8");
    const envVars = {};

    envContent.split("\n").forEach((line) => {
      const trimmedLine = line.trim();
      if (
        trimmedLine &&
        !trimmedLine.startsWith("#") &&
        trimmedLine.includes("=")
      ) {
        const equalIndex = trimmedLine.indexOf("=");
        const key = trimmedLine.substring(0, equalIndex).trim();
        const value = trimmedLine.substring(equalIndex + 1).trim();

        if (key && value) {
          envVars[key] = value;
        }
      }
    });

    console.log("🔧 Loaded environment variables:", Object.keys(envVars));

    return envVars;
  } catch (error) {
    console.error("❌ Error reading .env file:", error.message);
    console.error("Create a .env file with your Sanity credentials");
    process.exit(1);
  }
}

// Load environment variables
const env = loadEnvFile();
const projectId = env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = env.NEXT_PUBLIC_SANITY_DATASET;
const token = env.SANITY_API_READ_TOKEN;

if (!projectId || !dataset || !token) {
  console.error("❌ Missing required environment variables in .env file:");
  console.error("   NEXT_PUBLIC_SANITY_PROJECT_ID");
  console.error("   NEXT_PUBLIC_SANITY_DATASET");
  console.error("   SANITY_API_READ_TOKEN");
  process.exit(1);
}

const perspective =
  env.SANITY_PERSPECTIVE === "published"
    ? "published"
    : env.SANITY_PERSPECTIVE === "drafts"
      ? "drafts"
      : "published";

// GROQ query to fetch sponsor sections
const query = `*[_type == "page"]{
  "sponsorSections": components[_type == "sponsorSection"]
}`;

// Make HTTPS request to check profile via GraphQL API
function fetchFromGraphQL(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const apiUrl = "https://beta.node.thegrid.id/graphql";

    const postData = JSON.stringify({
      query: query,
      variables: variables,
    });

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(apiUrl, options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            console.error("GraphQL Error Response:", data);
            reject(
              new Error(
                `GraphQL request failed: ${res.statusCode} ${res.statusMessage}`,
              ),
            );
          }
        } catch (error) {
          console.error("Raw response:", data);
          reject(
            new Error(`Failed to parse GraphQL response: ${error.message}`),
          );
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(postData);
    req.end();
  });
}

// Make HTTPS request to Sanity API
function fetchFromSanity(query) {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://${projectId}.api.sanity.io/v2025-03-04/data/query/${dataset}`;
    const params = new URLSearchParams({
      query: query,
      perspective: perspective,
    });

    const url = `${apiUrl}?${params}`;

    const options = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(url, options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            console.error("API Error Response:", data);
            reject(
              new Error(
                `API request failed: ${res.statusCode} ${res.statusMessage}`,
              ),
            );
          }
        } catch (error) {
          console.error("Raw response:", data);
          reject(new Error(`Failed to parse API response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.end();
  });
}

async function fetchGridDataBatch(slugs) {
  try {
    const batchSize = 50; // Reasonable batch size to avoid query complexity limits
    const allProfiles = [];

    // Process slugs in batches
    for (let i = 0; i < slugs.length; i += batchSize) {
      const batchSlugs = slugs.slice(i, i + batchSize);
      console.log(
        `🔍 Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(slugs.length / batchSize)} (${batchSlugs.length} slugs)`,
      );

      const graphqlQuery = `query BatchProfiles($slugs: [String!]!) {
        roots(where: {slug: {_in: $slugs}}) {
          id
          slug
          urlMain
          profileTags {
            id
            tagId
            tag {
              id
              name
            }
          }
        }
      }`;

      const result = await fetchFromGraphQL(graphqlQuery, {
        slugs: batchSlugs,
      });
      if (result.data?.roots) {
        allProfiles.push(...result.data.roots);
      }

      // Small delay between batches to be respectful
      if (i + batchSize < slugs.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return allProfiles;
  } catch (error) {
    console.error(`❌ Error fetching batch grid data:`, error.message);
    return [];
  }
}

async function getTagDetails(tagIds) {
  if (tagIds.length === 0) return [];

  try {
    const graphqlQuery = `query GetTagDetails($tagIds: [String!]!) {
      tags(where: {id: {_in: $tagIds}}) {
        id
        name
      }
    }`;

    const result = await fetchFromGraphQL(graphqlQuery, { tagIds });
    return result.data?.tags || [];
  } catch (error) {
    console.error("Error fetching tag details:", error.message);
    return [];
  }
}

async function processGridProfilesWithTags(profiles, sponsorSlugs) {
  const targetExternalTagId = "id1760088086-NEyjzLNeTcyFkhytuCu6RQ";

  // Collect all unique tag IDs from the nested tag data
  const allTagIds = new Set();
  profiles.forEach((profile) => {
    profile.profileTags?.forEach((profileTag) => {
      if (profileTag.tag?.id) {
        allTagIds.add(profileTag.tag.id);
      }
    });
  });

  console.log(`🏷  Found ${allTagIds.size} unique tags from profiles`);

  // Check if target tag is in the data
  const hasTargetTagInData =
    Array.from(allTagIds).includes(targetExternalTagId);
  if (hasTargetTagInData) {
    console.log(`🎯 Target Breakpoint 2025 tag found in data!`);
  } else {
    console.log(
      `!  Target Breakpoint 2025 tag (${targetExternalTagId}) not found in any profile`,
    );
  }

  const profileMap = new Map();

  // Create a map of slug -> profile data
  profiles.forEach((profile) => {
    const hasTargetTag =
      profile.profileTags?.some(
        (profileTag) => profileTag.tag?.id === targetExternalTagId,
      ) || false;
    const hasBreakpointTag = hasTargetTag; // Same as target tag for now

    // Extract tag data from nested structure
    const enrichedTags =
      profile.profileTags?.map((profileTag) => ({
        id: profileTag.tag?.id || profileTag.id,
        name: profileTag.tag?.name || "Unknown",
      })) || [];

    profileMap.set(profile.slug, {
      exists: true,
      id: profile.id,
      slug: profile.slug,
      urlMain: profile.urlMain,
      hasTargetTag,
      hasBreakpointTag,
      externalTags: enrichedTags,
    });
  });

  // Return results for all requested slugs, including missing ones
  return sponsorSlugs.map((slug) => {
    return (
      profileMap.get(slug) || {
        exists: false,
        error: "Profile not found",
        slug: slug,
        externalTags: [],
      }
    );
  });
}

async function fetchSponsors() {
  try {
    console.log("🔍 Fetching sponsors from Sanity API...");

    const result = await fetchFromSanity(query);
    const pages = result.result || [];

    const allSponsors = [];
    const allSupportingSponsors = [];

    // Extract sponsors from all pages
    pages.forEach((page) => {
      if (page.sponsorSections) {
        page.sponsorSections.forEach((section) => {
          if (section._type === "sponsorSection") {
            if (section.sponsors) {
              allSponsors.push(...section.sponsors);
            }
            if (section.supportingSponsors) {
              allSupportingSponsors.push(...section.supportingSponsors);
            }
          }
        });
      }
    });

    console.log(
      `✅ Found ${allSponsors.length} main sponsors and ${allSupportingSponsors.length} supporting sponsors`,
    );

    return {
      sponsors: allSponsors,
      supportingSponsors: allSupportingSponsors,
      combined: [...allSponsors, ...allSupportingSponsors],
    };
  } catch (error) {
    console.error("❌ Error fetching sponsors from API:", error.message);
    process.exit(1);
  }
}

async function validateSponsorsWithGrid(apiSponsors, gridConstants) {
  console.log(
    "\n📊 Validating sponsors against constants grid and fetching Grid data...",
  );

  // Extract titles from API sponsors
  const apiSponsorTitles = apiSponsors.combined
    .map((sponsor) => sponsor.title)
    .filter((title) => title) // Remove undefined/empty titles
    .sort();

  // Extract keys from grid constants (excluding null values)
  const gridKeys = Object.keys(gridConstants)
    .filter((key) => gridConstants[key] !== null)
    .sort();

  // Find missing sponsors (in API but not in constants)
  const missingInConstants = apiSponsorTitles.filter(
    (title) => !gridKeys.includes(title),
  );

  // Find extra constants (in constants but not in API)
  const extraInConstants = gridKeys.filter(
    (key) => !apiSponsorTitles.includes(key),
  );

  // Fetch Grid data for all sponsors with slugs in batches
  console.log("\n🔍 Checking Grid profiles via GraphQL (batch mode)...");

  // Collect all valid slugs and their corresponding sponsor titles
  const slugsToFetch = [];
  const slugToSponsorMap = new Map();

  for (const [sponsorTitle, slug] of Object.entries(gridConstants)) {
    if (slug && slug !== null) {
      slugsToFetch.push(slug);
      slugToSponsorMap.set(slug, sponsorTitle);
    }
  }

  console.log(`📊 Found ${slugsToFetch.length} slugs to check in Grid`);

  // Fetch all profiles in batches
  const allProfiles = await fetchGridDataBatch(slugsToFetch);
  console.log(`✅ Retrieved ${allProfiles.length} profiles from Grid`);

  // Process results to match with sponsor data
  const profileResults = await processGridProfilesWithTags(
    allProfiles,
    slugsToFetch,
  );

  // Create final results array with sponsor information
  const gridDataResults = profileResults.map((profileData) => ({
    sponsorTitle: slugToSponsorMap.get(profileData.slug),
    slug: profileData.slug,
    exists: profileData.exists,
    profileId: profileData.id || null,
    profileSlug: profileData.slug || profileData.slug,
    urlMain: profileData.urlMain || null,
    hasTargetTag: profileData.hasTargetTag || false,
    hasBreakpointTag: profileData.hasBreakpointTag || false,
    externalTags: profileData.externalTags || [],
    error: profileData.error || null,
  }));

  // Generate report
  console.log("\n" + "=".repeat(80));
  console.log("                    SPONSOR VALIDATION REPORT");
  console.log("=".repeat(80));

  console.log(`\n📈 SUMMARY:`);
  console.log(`   API Sponsors Total: ${apiSponsors.combined.length}`);
  console.log(`   API Sponsors with titles: ${apiSponsorTitles.length}`);
  console.log(`   Constants Grid entries: ${gridKeys.length}`);
  console.log(`   Missing from constants: ${missingInConstants.length}`);
  console.log(`   Extra in constants: ${extraInConstants.length}`);
  console.log(`   Grid slugs checked: ${gridDataResults.length}`);

  if (extraInConstants.length > 0) {
    console.log(
      `\n!  CONSTANTS NOT FOUND IN API (${extraInConstants.length}):`,
    );
    extraInConstants.forEach((key) => {
      const slug = gridConstants[key];
      console.log(`   • ${key} → ${slug}`);
    });
  }

  if (missingInConstants.length === 0 && extraInConstants.length === 0) {
    console.log("\n✅ ALL SPONSORS MATCH! No discrepancies found.");
  }

  // Show Grid data results
  const existingProfiles = gridDataResults.filter((result) => result.exists);
  const missingProfiles = gridDataResults.filter((result) => !result.exists);
  const breakpointSponsors = gridDataResults.filter(
    (result) => result.hasBreakpointTag,
  );
  const targetTagSponsors = gridDataResults.filter(
    (result) => result.hasTargetTag,
  );

  console.log(`\n🌐 GRID PROFILE CHECK RESULTS:`);
  console.log(
    `   Profiles found in Grid: ${existingProfiles.length}/${gridDataResults.length}`,
  );
  console.log(`   Profiles not found: ${missingProfiles.length}`);
  console.log(
    `   Profiles with errors: ${gridDataResults.filter((r) => r.error && r.error !== "Profile not found").length}`,
  );
  console.log(
    `   Sponsors with "Breakpoint 2025" tag: ${breakpointSponsors.length}`,
  );
  console.log(
    `   Sponsors with target tag (id1760088086-NEyjzLNeTcyFkhytuCu6RQ): ${targetTagSponsors.length}`,
  );

  // if (breakpointSponsors.length > 0) {
  //   console.log(`\n🎯 BREAKPOINT 2025 SPONSORS:`);
  //   breakpointSponsors.forEach((sponsor) => {
  //     console.log(
  //       `   • ${sponsor.sponsorTitle} (${sponsor.profileSlug}) - ID: ${sponsor.profileId}`,
  //     );
  //   });
  // }
  //
  // if (targetTagSponsors.length > 0) {
  //   console.log(`\n🏷  TARGET TAG SPONSORS:`);
  //   targetTagSponsors.forEach((sponsor) => {
  //     console.log(
  //       `   • ${sponsor.sponsorTitle} (${sponsor.profileSlug}) - ID: ${sponsor.profileId}`,
  //     );
  //   });
  // }
  //
  // if (existingProfiles.length > 0) {
  //   console.log(`\n✅ EXISTING PROFILES IN GRID:`);
  //   existingProfiles.forEach((sponsor) => {
  //     const tagNames = sponsor.externalTags
  //       .map((tag) => tag.name)
  //       .filter((name) => name !== "Unknown");
  //     const tagIds = sponsor.externalTags.map((tag) => tag.id).slice(0, 3);
  //     const tagSummary =
  //       tagNames.length > 0
  //         ? ` (${tagNames.slice(0, 3).join(", ")}${tagNames.length > 3 ? "..." : ""})`
  //         : tagIds.length > 0
  //           ? ` (IDs: ${tagIds.join(", ")}${sponsor.externalTags.length > 3 ? "..." : ""})`
  //           : "";
  //     console.log(
  //       `   • ${sponsor.sponsorTitle} (${sponsor.profileSlug}) - Tags: ${sponsor.externalTags.length}${tagSummary}`,
  //     );
  //   });
  // }

  if (missingInConstants.length > 0) {
    console.log(
      `\n❌ SPONSORS IN API BUT MISSING FROM CONSTANTS (${missingInConstants.length}):`,
    );
    missingInConstants.forEach((title) => {
      console.log(`   • ${title}`);
    });
  }

  if (missingProfiles.length > 0) {
    console.log(`\n❌ MISSING PROFILES:`);
    missingProfiles.forEach((sponsor) => {
      console.log(`   • ${sponsor.sponsorTitle} (${sponsor.slug})`);
    });
  }

  console.log("\n" + "=".repeat(80));

  // Show detailed breakdown by category
  console.log(`\n📋 DETAILED BREAKDOWN:`);
  console.log(`   Main sponsors: ${apiSponsors.sponsors.length}`);
  console.log(
    `   Supporting sponsors: ${apiSponsors.supportingSponsors.length}`,
  );

  const sponsorsWithoutTitles = apiSponsors.combined.filter(
    (sponsor) => !sponsor.title,
  );
  if (sponsorsWithoutTitles.length > 0) {
    console.log(
      `\n!  SPONSORS WITHOUT TITLES (${sponsorsWithoutTitles.length}):`,
    );
    sponsorsWithoutTitles.forEach((sponsor, index) => {
      console.log(`   • Sponsor ${index + 1} (key: ${sponsor._key || "N/A"})`);
    });
  }

  return {
    isValid: missingInConstants.length === 0 && extraInConstants.length === 0,
    missingInConstants,
    extraInConstants,
    apiSponsorTitles,
    gridKeys,
    gridDataResults,
    existingProfiles,
    missingProfiles,
    breakpointSponsors,
    targetTagSponsors,
  };
}

function generateCSV(data) {
  const headers = [
    "Sponsor Title",
    "Slug",
    "Profile Exists in Grid",
    "Profile ID",
    "Profile Slug",
    "Main URL",
    "Has Breakpoint 2025 Tag",
    "Has Target Tag",
    "External Tags Count",
    "Tag IDs",
    "Tag Names",
    "Error",
  ];

  const csvRows = [headers.join(",")];

  data.gridDataResults.forEach((result) => {
    const tagIds = result.externalTags.map((tag) => tag.id).join("; ");
    const tagNames = result.externalTags
      .map((tag) => tag.name)
      .filter((name) => name !== "Unknown")
      .join("; ");

    const row = [
      `"${result.sponsorTitle}"`,
      `"${result.slug}"`,
      result.exists ? "Yes" : "No",
      `"${result.profileId || ""}"`,
      `"${result.profileSlug || ""}"`,
      `"${result.urlMain || ""}"`,
      result.hasBreakpointTag ? "Yes" : "No",
      result.hasTargetTag ? "Yes" : "No",
      result.externalTags.length,
      `"${tagIds}"`,
      `"${tagNames}"`,
      `"${result.error || ""}"`,
    ];
    csvRows.push(row.join(","));
  });

  return csvRows.join("\n");
}

function displayTable(data) {
  console.log("\n📊 SPONSOR GRID PROFILE CHECK TABLE:");
  console.log("=".repeat(130));

  const headers = [
    "Sponsor",
    "Slug",
    "Profile Exists",
    "Profile ID",
    "Breakpoint 2025",
    "Target Tag",
    "Tags Count",
  ];
  const colWidths = [20, 15, 15, 12, 15, 12, 12];

  // Print header
  let headerRow = "";
  headers.forEach((header, i) => {
    headerRow += header.padEnd(colWidths[i]) + " | ";
  });
  console.log(headerRow);
  console.log("-".repeat(130));

  // Print rows
  data.gridDataResults.forEach((result) => {
    const row = [
      result.sponsorTitle.length > 17
        ? result.sponsorTitle.substring(0, 17) + "..."
        : result.sponsorTitle,
      result.slug.length > 12
        ? result.slug.substring(0, 12) + "..."
        : result.slug,
      result.exists ? "✅" : "❌",
      result.profileId ? result.profileId.substring(0, 9) + "..." : "",
      result.hasBreakpointTag ? "✅" : "❌",
      result.hasTargetTag ? "✅" : "❌",
      result.externalTags.length.toString(),
    ];

    let dataRow = "";
    row.forEach((cell, i) => {
      dataRow += String(cell).padEnd(colWidths[i]) + " | ";
    });
    console.log(dataRow);
  });

  console.log("=".repeat(130));
}

async function main() {
  console.log("🚀 Starting Standalone Sponsor Validation Script\n");

  const apiSponsors = await fetchSponsors();
  const validation = await validateSponsorsWithGrid(apiSponsors, GRID_SLUGS);

  // Display table in terminal
  displayTable(validation);

  // Generate and save CSV
  const csvContent = generateCSV(validation);
  const csvFilename = `sponsor-validation-${new Date().toISOString().split("T")[0]}.csv`;

  try {
    fs.writeFileSync(csvFilename, csvContent, "utf8");
    console.log(`\n📄 CSV report saved to: ${csvFilename}`);
  } catch (error) {
    console.error("❌ Error saving CSV file:", error.message);
  }

  process.exit(validation.isValid ? 0 : 1);
}

// Run the script
main().catch((error) => {
  console.error("💥 Unexpected error:", error);
  process.exit(1);
});
