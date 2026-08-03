Wonne International - Composition-First Medicine Lookup API

1. Executive Summary

The Composition-First Medicine Lookup API is a high-performance, fuzzy-matching Node.js backend. It acts as the "brain" for the Wonne International Voice AI Agent (Maansi).

Voice AI often struggles with pharmaceutical terms due to phonetic misspellings by Speech-to-Text (STT) engines (e.g., hearing "Domeprozol" instead of "Omeprazole"). Furthermore, standard search engines often confuse Brand Names with Generic Salts (e.g., returning Tycolin Plus when the user asked for generic Citicoline).

The Solution: This API completely removes Brand Names from the search index. It strictly evaluates the user's spoken words against the Composition field of the database using a Two-Layered Phonics Algorithm. It guarantees that the AI agent never hallucinates brands or aggressively sells a specific brand when the caller is looking for a generic salt.

2. System Architecture & Data Flow

This ASCII diagram illustrates how a user's voice request travels through the AI Agent, into the Node.js API, and back to the user as natural, spoken Hindi/English.

 +---------------------+       1. Voice ("I need Domeprozol")    +-----------------------+
 | Pharmacy Owner      |  -------------------------------------> |   Oration AI Engine   |
 | (Caller)            |       Transcribed as text               |   (STT / TTS Engine)  |
 +---------------------+                                         +-----------------------+
           ^                                                                 |
           | 6. AI Agent speaks natural                              2. Trigger Tool: 
           |    Hindi response based on Tiers                        medicine_lookup("Domeprozol")
           |                                                                 |
 +---------------------+       5. JSON Payload Returned          +-----------------------+
 |  AI Agent Prompt    |  <------------------------------------- |  Node.js API Server   |
 | (Cognitive Firewall)|   {                                     |  (Port 8000)          |
 +---------------------+     "status": "exact_match",            +-----------------------+
                             "matches": [                                    |
                               {                                             | 3. Unit Scrubbing
                                 "Brand Name": "Ortazol D",                  |    (removes "mg")
                                 "Composition": "Omeprazole + Domperidone",  |
                                 "Dosage": "Capsule",                        | 4. Two-Layer Match
                                 "matched_via": "Composition",               |    (Scores 80%)
                                 "confidence": 80.0                          |
                               }                                             |
                             ]                                               |
                           }                                                 |
                                                                             |


3. The Algorithm: Simple vs. Technical Breakdown

To solve complex pharmaceutical matching, the API uses two simultaneous algorithms from the fuzzball (RapidFuzz) library.

A. Simple Explanation (How it acts like a Smart Pharmacist)

Imagine a customer walks into a pharmacy and mumbles, "I need Citicoline." 1. The Macro Search: The pharmacist looks at a box that says "Citicoline 500mg + Piracetam 800mg". The pharmacist knows that because the mumbled word is a perfect piece of that long label, it's a 100% match.
2. The Micro Search: Now imagine the customer mumbles heavily: "Domeprozol". The pharmacist mentally breaks down the label "Omeprazole + Domperidone" into individual words. They realize "Domeprozol" sounds 80% similar to "Omeprazole". They hand the customer the right medicine.

B. Technical Deep Dive (The Code Logic)

The search endpoint (POST /medicine_lookup) executes the following operations in milliseconds:

Unit Scrubbing (scrubNoise): * Regex (/\b(mg|ml|gm|tablet)\b/gi) strips weights and metrics.

Why? If a user asks for "Foropenem 100", we don't want the "100" to artificially trigger an 80% match with "Amiodarone 100 mg".

Layer 1: The Macro Search (fuzz.token_set_ratio):

This algorithm tokenizes both strings, finds the intersection, and calculates the similarity of the remaining tokens.

Why? It heavily favors subset matches. If query = "Hydroxyzine" and db = "Hydroxyzine Hydrochloride 25 mg", the score is exactly 100.0 because the query is fully contained within the database string.

Layer 2: The Granular Token Safety Net (fuzz.ratio):

The API splits the long database composition into an array of pure chemical words: ["Omeprazole", "Domperidone"].

It loops through the user's spoken words and performs a direct Levenshtein distance calculation (fuzz.ratio) against each chemical word independently.

Why? token_set_ratio fails if the user makes a heavy phonetic typo. The Granular loop catches typos like "Vonsar" -> "Faropenem" by isolating the words and overwriting the score with the highest individual word match.

4. AI Agent Integration (The 4-Tier Matrix)

The Node.js API does not generate speech; it categorizes the data and tags it with a status. The LLM Agent uses this status to dynamically route the conversation.

| API status Tag | Trigger Condition | AI Agent Behavior (Prompt Output) |
| exact_match | Top score is ≥ 85%, and only 1 medicine shares this top score. | Tier 1 (Instant Close): Reads Brand, Dosage, and Price. Asks for the order quantity immediately. |
| multiple_exact_matches | Top score is ≥ 85%, but multiple medicines share this score (e.g., User asked for "Sitagliptin", triggering 5 variants). | Tier 2 (Variant Narrowing): Reads the Brand names and Dosages to group them naturally. Hides the price. Asks user which variant/mg they want. |
| multiple_options | Top score is between 65% - 84%. The STT caught a blurry, misspelled word. | Tier 3 (Collision Rescue): Uses an "empathy wrapper" (e.g., "Voice broke up..."). Names the top 2 options and asks user to clarify. |
| no_match | No composition scored above 65%. | Tier 4 (Spelling Fallback): Admits the drug is unlisted and asks the user to spell out the salt letter-by-letter. |

5. API Endpoint Specification

POST /medicine_lookup

Request Payload:

{
  "query": "Domeprozol"
}


Response Payload (Success):

{
  "status": "exact_match",
  "matches": [
    {
      "Sno": 16,
      "Brand Name": "Ortazol D",
      "Dosage": "Capsule",
      "Composition": "Omeprazole 20 mg + Domperidone 10 mg.",
      "Pack": "10x10 Alu Alu",
      "Price": 50.0,
      "Prescribing Specialities": "Gastroenterologist",
      "matched_via": "Composition",
      "confidence": 80.0
    }
  ]
}


6. Code Walkthrough (server.js)

Here is a simplified step-by-step breakdown of the runtime logic inside the /medicine_lookup route:

Input Validation: Ensure req.body.query exists.

Noise Scrubbing: cleanQuery = scrubNoise(query) removes numbers and units.

Query Tokenization: queryTokens = cleanQuery.split() breaks the user's speech into individual words for the Micro Search.

The Evaluation Loop: Iterates over every object in medicineDb.

Macro Check: compScore = fuzz.token_set_ratio(cleanQuery, comp)

Micro Check: Nested for loop comparing queryTokens against compTokens. Overwrites compScore if a higher match is found.

Thresholding: If compScore >= 65.0, the medicine is added to the finalMatches array.

Sorting & Slicing: Sorts finalMatches by confidence (highest first) and limits the array to the top 5 results to prevent LLM context-window bloat.

Status Calculation: Assesses highestScore and array length to determine whether to output exact_match, multiple_exact_matches, or multiple_options.

7. Cloudflare Worker Deployment via GitHub (CI/CD)

Deploying via the Cloudflare dashboard linked to GitHub is the most robust way to host your API. By connecting GitHub to Cloudflare, any changes you push to your GitHub repository will automatically trigger Cloudflare to rebuild and deploy your updated API instantly.

Phase 1: Adapting Your Express Code (server.js)

To run Express natively on Cloudflare Workers, you must convert the file to use ES Modules (import/export) and wrap the server with Cloudflare's httpServerHandler.

Update the top and bottom of your server.js:

// AT THE TOP: Use import instead of require
import { httpServerHandler } from 'cloudflare:node';
import express from 'express';
import cors from 'cors';
import fuzz from 'fuzzball';

const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());

// ... [Keep your database and logic exactly the same] ...

// AT THE BOTTOM: 
app.listen(PORT);

// Export the app via the Cloudflare Node.js wrapper
export default httpServerHandler({ port: PORT });


Important: You must add "type": "module" to your package.json file to enable ES modules.

Phase 2: Create Cloudflare Configuration (wrangler.toml)

Create a file named wrangler.toml in your project's root directory. This tells Cloudflare how to run your Node.js application.

name = "wonne-medicine-api"
main = "server.js"
compatibility_date = "2024-05-01"
compatibility_flags = [ 
  "nodejs_compat", 
  "enable_nodejs_http_modules", 
  "enable_nodejs_http_server_modules" 
]
workers_dev = true


Phase 3: Pushing Your Code to GitHub

Before Cloudflare can deploy your API, your code needs to live on GitHub. Open your computer's terminal (Command Prompt/PowerShell/Terminal) in your project folder and run the following commands:

Initialize Git and Ignore Clutter:

git init
echo "node_modules/" > .gitignore
echo ".wrangler/" >> .gitignore


Commit Your Code:

git add .
git commit -m "Initial commit of Wonne Medicine API"


Push to a New GitHub Repository:
Go to GitHub.com, create a new empty repository, and follow the instructions to push your existing code:

git branch -M main
git remote add origin [https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git](https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git)
git push -u origin main


Phase 4: Deploying via the Cloudflare Dashboard

Now that your code is safely on GitHub, we will link it to Cloudflare for automatic deployments.

Log in to the Cloudflare Dashboard.

On the left sidebar, click Workers & Pages.

Click the Create Application button, and then click Create Worker.

Name your worker (e.g., wonne-medicine-api) and click Deploy (this deploys a default "Hello World" app temporarily).

Once deployed, click Configure Worker.

Navigate to the Build & Deploy tab (or Settings > Integrations depending on dashboard updates).

Look for the option to Connect to GitHub (Continuous Deployment / CI/CD).

Authenticate with GitHub and select your new repository (YOUR_REPO_NAME).

Cloudflare will automatically set up a "GitHub Action" in your repository.

Result: From now on, whenever you edit your server.js or update your medicineDb and run git push, Cloudflare will automatically detect the push, rebuild your API, and deploy it to their global edge network in seconds!

Phase 5: Oration AI Tool Setup (Hitting the Endpoint)

Once deployed, Cloudflare will give you a live, SSL-secured URL (e.g., https://wonne-medicine-api.<your-username>.workers.dev).

Configure your Tool inside the Oration AI platform as follows:

Tool Name: medicine_lookup

Method: POST

Endpoint URL: https://wonne-medicine-api.<your-username>.workers.dev/medicine_lookup

Headers:

Content-Type: application/json

Payload Structure:

{
  "query": "{{spoken_words}}"
}


Because Cloudflare Workers run at global edge nodes closest to the user, the Oration AI Agent will receive the JSON response in mere milliseconds, ensuring the voice agent continues the conversation smoothly without any unnatural pausing.