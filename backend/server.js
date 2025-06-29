const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const mongoose = require("mongoose");
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const yf = require('yahoo-finance2').default;

const userController = require("./userController/userController");
const { userSchemaModel } = require('./userController/userModel');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/reports', express.static(path.join(__dirname, 'reports')));

const upload = multer({ storage: multer.memoryStorage() });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

mongoose.connect("mongodb://localhost:27017/StockLLM", {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.log("❌ MongoDB error:", err));

// User routes
app.post("/user/signup", userController.userCreate);
app.post("/user/login", userController.userLogin);
app.post('/user/details', userController.userDetails);

// Helper to extract JSON from markdown-like Gemini AI response
function extractJsonFromMarkdown(rawText) {
  // Try to extract JSON inside ```json ... ``` fences
  const codeFenceMatch = rawText.match(/```json([\s\S]*?)```/i);
  if (codeFenceMatch && codeFenceMatch[1]) {
    return codeFenceMatch[1].trim();
  }
  // Try to find a JSON array anywhere in text
  const jsonArrayMatch = rawText.match(/\[.*\]/s);
  if (jsonArrayMatch) {
    return jsonArrayMatch[0];
  }
  // If none found, return null
  return null;
}

// Generate portfolio report from screenshots
app.post('/generate-report', upload.array('screenshots'), async (req, res) => {
  const goal = req.body.goal;
  const files = req.files;
  const email = req.body.email;

  if (!goal || !files || files.length === 0 || !email) {
    return res.status(400).json({ error: 'Missing goal, screenshots, or email' });
  }

  try {
    const imageParts = files.map(file => ({
      inlineData: {
        mimeType: file.mimetype,
        data: file.buffer.toString('base64'),
      }
    }));

    const prompt = `
You are a professional financial advisor AI. Your ONLY task is to analyze the user's investment portfolio using **ONLY AND EXCLUSIVELY** the data **DIRECTLY VISIBLE** in the uploaded screenshots. You must not use any external knowledge, assume any information, or hallucinate. If a piece of data is not visible, you MUST state "N/A" or "Not visible in screenshot."

USER GOAL: "${goal}"

INSTRUCTIONS:
- Generate a report with EXACTLY 8 sections.
- Use the precise titles and formatting: 1. *Section Title*.
- Each section (1-7) should be 2-4 short paragraphs.
- **Crucially, for sections 2, 3, 4, and 5, you must provide a direct answer or assessment based on the best inferences possible from the visible screenshot data, even if full context is missing. Clearly explain the reasoning and state any necessary assumptions.**
- Section 8 MUST be a markdown table containing ONLY the assets and data visible in the screenshot.

REQUIRED SECTIONS:
1. *Summary & Portfolio Characteristics*
2. *Goal Alignment Grade*
3. *Goal Alignment Percentage*
4. *Risk Meter*
5. *Estimated 5-Year Return*
6. *Where You Are Strong*
7. *Where You Need to Improve*
8. *Asset Allocation Breakdown*

SECTION 8 FORMAT:
- Create a Markdown table.
- **INCLUDE ONLY ASSETS THAT ARE VISIBLE IN THE 'HOLDINGS' TABLE OF THE SCREENSHOT.**
- **DO NOT INCLUDE ANY ASSETS NOT DIRECTLY SEEN IN THE PROVIDED IMAGES.**
- Use these exact column headers: "Asset Name", "Type", "Invested Amount", "Current Value".
  - **Asset Name:** Extract the exact text from the 'Instrument' column.
  - **Type:** For every asset visible in this table, its Type is 'Stock'.
  - **Invested Amount:** **CALCULATE THIS EXPLICITLY.** Multiply the value from the 'Qty' column by the value from the 'Avg. cost' column for each row. Format as currency (e.g., ₹1234.56). **If 'Qty' or 'Avg. cost' is NOT clearly visible for a specific row, then write "N/A" for that row's 'Invested Amount'.**
  - **Current Value:** Extract the exact numerical value from the 'Cur. val' column. Format as currency (e.g., ₹1234.56).
- The table must contain ALL rows visible in the 'Holdings' section of the screenshot.
- Example of Section 8 (populate this with actual data extracted from the screenshot):
Asset Name | Type | Invested Amount | Current Value
-----------|------|-----------------|--------------
PAYTM      | Stock| ₹49684.80       | ₹11251.35
SUVIDHAA   | Stock| ₹54068.72       | ₹19703.76
HAPPSTMNDS | Stock| ₹25803.00       | ₹14563.80
POLYPLEX   | Stock| ₹25553.70       | ₹15316.20
CARTTRADE  | Stock| ₹25273.90       | ₹15265.15
(and so on for any other stock clearly visible in the screenshot table)

**Specific Guidance for Sections 2, 3, 4, 5:**

**2. *Goal Alignment Grade***
- **Assign a letter grade (A, B, C, or D)** based on the visible assets and their performance relative to a typical 'building wealth' goal, assuming a moderately aggressive, long-term approach.
- **Explain your reasoning:** Reference specific visible portfolio characteristics (e.g., presence of high-growth potential stocks, significant P&L swings, diversification levels) that led to this grade. State that this is a preliminary grade based solely on the screenshot.

**3. *Goal Alignment Percentage***
- **Provide a qualitative percentage assessment or a broad range.** Example: "Low alignment (0-30%)", "Moderate alignment (30-70%)", or "High alignment (70-100%)". Do not attempt a precise numerical calculation.
- **Explain your reasoning:** Connect the visible portfolio's characteristics to this percentage, acknowledging missing context like exact financial targets.

**4. *Risk Meter***
- **Assign a clear risk level:** Choose from "Very Low," "Low," "Moderate," "High," or "Very High."
- **Justify your assessment:** Point to specific visible assets (e.g., individual stocks, significant unrealized losses) and the overall composition that indicate this risk level.

**5. *Estimated 5-Year Return***
- **Provide a qualitative assessment of potential return:** Examples: "Aggressive Growth Potential," "Moderate Growth Potential," "Limited Growth Potential," or "Uncertain Growth Potential." **DO NOT give a specific numerical percentage.**
- **Explain your reasoning:** Base this on the visible asset types (e.g., growth stocks vs. stable assets) and the general market conditions implied by current P&L, acknowledging that this is a speculative estimate from limited data.
`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 3000,
      },
    });

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          ...imageParts
        ],
      }]
    });

    const rawReport = result.response.text();
    const report = cleanAndValidateReport(rawReport);
    const assetSection = extractAssetBreakdown(report);
    const assetList = parseAssets(assetSection);

    const reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    const filename = `${Date.now()}_${email.replace(/[@.]/g, '_')}_report.pdf`;
    const fullPath = path.join(reportsDir, filename);
    const publicPath = `reports/${filename}`;

    await generatePDF(report, fullPath);

    const user = await userSchemaModel.findOneAndUpdate(
      { email },
      {
        $push: {
          reports: {
            reportName: `Investment Report - ${new Date().toLocaleDateString()}`,
            reportData: report,
            reportPdf: publicPath,
            assets: assetList
          }
        }
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ report, pdfPath: publicPath });

  } catch (err) {
    console.error('❌ Error generating report:', err);
    res.status(500).json({
      error: 'Failed to generate report from screenshots.',
      message: err.message || 'Unknown error'
    });
  }
});

// Map stock names to Yahoo Finance ticker symbols using Gemini AI
async function mapToYahooTickersWithGemini(names = []) {
  const prompt = `
Map the following common Indian stock or mutual fund names to their correct Yahoo Finance ticker symbols (with .NS suffix if needed). If the name is unrecognized or ambiguous, respond with "N/A".

Return only JSON in the format:
[
  { "name": "ICICI Prudential Nifty Midcap 250 Index Fund - Growth", "ticker": "ICICIMCAP.NS" },
  { "name": "My Gold", "ticker": "GOLDBEES.NS" },
  ...
]

Names:
${names.join('\n')}
  `;

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(prompt);
  const raw = result.response.text();

  try {
    const cleanedJson = extractJsonFromMarkdown(raw);
    if (!cleanedJson) throw new Error("No JSON detected in Gemini response");
    const parsed = JSON.parse(cleanedJson);
    const map = {};
    parsed.forEach(entry => {
      if (entry.name && entry.ticker) {
        map[entry.name] = entry.ticker;
      }
    });
    return map;
  } catch (err) {
    console.error("Failed to parse Gemini ticker mapping:", err.message);
    return {};
  }
}

// Hardcoded fallback ticker map
const symbolMap = {
  "MIDCAPIETF-EQ": "MIDCAP.NS",
  "GOLDBEES-EQ": "GOLDBEES.NS",
  "NIFTYIETF-EQ": "NIFTYBEES.NS",
  "ICICI Prudential Nifty LargeMidcap 250 Index Fund - Growth": "ICICILARGEMID.NS", // Add your actual Yahoo symbol if known
};

// Symbol formatter fallback
function getYahooSymbol(name) {
  if (symbolMap[name]) return symbolMap[name];
  if (!name.endsWith('.NS')) return name + '.NS';
  return name;
}

async function getCAGR(symbol, investedDate) {
  try {
    if (!investedDate || !symbol || symbol === "N/A") return "N/A";

    const today = new Date();
    const fromDate = new Date(investedDate);
    const from = fromDate.toISOString().split('T')[0];
    const to = today.toISOString().split('T')[0];

    const result = await yf.historical(symbol, {
      period1: from,
      period2: to,
      interval: '1d'
    });

    if (!result || result.length < 2) {
      console.warn(`⚠️ No data for ${symbol} between ${from} and ${to}`);
      return "N/A";
    }

    result.sort((a, b) => new Date(a.date) - new Date(b.date));
    const startPrice = result[0]?.close;
    const endPrice = result[result.length - 1]?.close;
    if (!startPrice || !endPrice) return "N/A";

    const years = (today - fromDate) / (1000 * 60 * 60 * 24 * 365.25);
    const cagr = Math.pow(endPrice / startPrice, 1 / years) - 1;

    return (cagr * 100).toFixed(2) + "%";
  } catch (err) {
    console.error(`❌ Error fetching CAGR for ${symbol}:`, err.message);
    return "N/A";
  }
}

app.post('/analyze-returns', async (req, res) => {
  const stocks = req.body.stocks;
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return res.status(400).json({ error: "Invalid or missing stock data." });
  }

  try {
    const assetNames = [...new Set(stocks.map(s => s.name))];
    const geminiMap = await mapToYahooTickersWithGemini(assetNames);

    const stockResults = await Promise.all(stocks.map(async (stock) => {
      const fallback = getYahooSymbol(stock.name);
      const geminiSymbol = geminiMap[stock.name];
      const finalSymbol = (geminiSymbol && geminiSymbol !== "N/A") ? geminiSymbol : fallback;

      const date = stock.investedDate || stock.date; // ensure compatibility

      let stockCAGR = "N/A";
      let niftyCAGR = "N/A";

      if (date) {
        stockCAGR = await getCAGR(finalSymbol, date);
        niftyCAGR = await getCAGR("^NSEI", date); // NIFTY index
      }

      return {
        name: stock.name,
        ticker: finalSymbol,
        investedDate: date,
        annualReturn: stockCAGR,
        niftyCAGR
      };
    }));
    console.log(stockResults);
    res.json({ returns: stockResults });
  } catch (error) {
    console.error("❌ Error in analyze-returns:", error);
    res.status(500).json({ error: "Failed to calculate CAGR." });
  }
});


// PDF generation helper



function generatePDF(text, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.font('Helvetica').fontSize(12);

    const sectionColors = {
      1: '#2c3e50', 2: '#2980b9', 3: '#27ae60',
      4: '#d35400', 5: '#8e44ad', 6: '#16a085', 7: '#c0392b', 8: '#7f8c8d'
    };

    const lines = text.split('\n');
    let currentSection = 0;

    for (let line of lines) {
      const match = line.match(/^(\d)\.\s\*(.*?)\*/);
      if (match) {
        currentSection = match[1];
        const sectionTitle = match[2].trim();
        doc.moveDown(1)
          .fillColor(sectionColors[currentSection] || '#000')
          .fontSize(16)
          .font('Helvetica-Bold')
          .text(`${match[1]}. ${sectionTitle}`, { underline: true })
          .moveDown(0.5)
          .fontSize(12)
          .fillColor('black')
          .font('Helvetica');
      } else {
        doc.text(line, { lineGap: 4 });
      }
    }

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

// Clean and validate the AI-generated report to keep expected 8 sections
function cleanAndValidateReport(report) {
  report = report.trim().replace(/\r\n/g, '\n');
  const lines = report.split('\n');
  const expectedSections = [
    /^1\.\s*\*.*Summary.*Portfolio.*\*/i,
    /^2\.\s*\*.*Goal.*Alignment.*Grade.*\*/i,
    /^3\.\s*\*.*Goal.*Alignment.*Percentage.*\*/i,
    /^4\.\s*\*.*Risk.*Meter.*\*/i,
    /^5\.\s*\*.*Estimated.*5.*Year.*Return.*\*/i,
    /^6\.\s*\*.*Where.*Strong.*\*/i,
    /^7\.\s*\*.*Where.*Improve.*\*/i,
    /^8\.\s*\*.*Asset.*Allocation.*Breakdown.*\*/i
  ];

  let cleanedLines = [];
  let sectionCount = 0;
  let foundStart = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!foundStart && !trimmed) continue;
    const matchIndex = expectedSections.findIndex(pattern => pattern.test(trimmed));
    if (matchIndex === sectionCount) {
      foundStart = true;
      sectionCount++;
      cleanedLines.push(line);
    } else if (foundStart) {
      cleanedLines.push(line);
    }
  }

  return cleanedLines.join('\n');
}

// Extract Section 8: Asset Allocation Breakdown markdown table
function extractAssetBreakdown(report) {
  const lines = report.split('\n');
  const startIndex = lines.findIndex(line =>
    /^8\.\s*\*Asset\s*Allocation\s*Breakdown\*/i.test(line)
  );
  if (startIndex === -1) return '';
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^\d\.\s*\*/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }
  return lines.slice(startIndex + 1, endIndex).join('\n');
}

// Parse markdown table rows of assets to JS objects
const parseAssets = (text) => {
  const rows = text
    .split('\n')
    .map(line => line.trim())
    .filter(line =>
      line &&
      line.includes('|') &&
      !line.toLowerCase().includes('asset name') &&
      !line.includes('----')
    );

  const parsedRows = [];

  for (const row of rows) {
    const parts = row.split('|').map(cell => cell.trim()).filter(Boolean);
    if (parts.length === 4) {
      parsedRows.push({
        name: parts[0],
        type: parts[1],
        invested: parts[2],
        value: parts[3]
      });
    }
  }

  return parsedRows;
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: '✅ Server running',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`🔑 Gemini API Key configured: ${!!process.env.GEMINI_API_KEY}`);
});