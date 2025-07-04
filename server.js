const express = require("express");
const { chromium } = require("playwright");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Test endpoint
app.post("/execute-test", async (req, res) => {
  const { testCase } = req.body;

  if (!testCase) {
    return res.status(400).json({
      error: "testCase is required",
    });
  }

  let browser;
  const startTime = Date.now();

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });

    const results = [];

    for (const [index, step] of (testCase.steps || []).entries()) {
      try {
        const stepResult = await executeStep(page, step);
        results.push({
          stepIndex: index,
          step: step.description || `Step ${index + 1}`,
          status: "passed",
          result: stepResult,
        });
      } catch (error) {
        results.push({
          stepIndex: index,
          step: step.description || `Step ${index + 1}`,
          status: "failed",
          error: error.message,
        });

        if (step.continueOnFail !== true) {
          break;
        }
      }
    }

    await browser.close();

    const overallStatus = results.every((r) => r.status === "passed")
      ? "passed"
      : "failed";

    // Thêm testCaseId và testName làm hai field độc lập
    const testCaseId = testCase.id || null; // Giá trị mặc định là null nếu không có
    const testName = testCase.name || "Unnamed Test";

    res.json({
      testCaseId: testCaseId,
      testName: testName,
      status: overallStatus,
      duration: Date.now() - startTime,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error("Error closing browser:", closeError.message);
      }
    }

    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Helper function to execute individual steps (unchanged)
async function executeStep(page, step) {
  switch (step.action?.toLowerCase()) {
    case "goto":
      await page.goto(step.url, { waitUntil: "networkidle", timeout: 30000 });
      return { url: page.url() };

    case "click":
      await page.click(step.selector, { timeout: 10000 });
      return { clicked: step.selector };

    case "fill":
    case "type":
      await page.fill(step.selector, step.value, { timeout: 10000 });
      return { filled: step.selector, value: step.value };

    case "wait":
      if (step.selector) {
        await page.waitForSelector(step.selector, {
          timeout: step.timeout || 10000,
        });
        return { waited: "for selector: " + step.selector };
      } else {
        await page.waitForTimeout(step.timeout || 1000);
        return { waited: step.timeout + "ms" };
      }

    case "screenshot":
      const screenshot = await page.screenshot({
        encoding: "base64",
        fullPage: step.fullPage || false,
      });
      const screenshotStr =
        typeof screenshot === "string"
          ? screenshot
          : screenshot.toString("base64");
      return { screenshot: screenshotStr.substring(0, 100) + "..." };

    case "expect":
    case "assert":
      const element = page.locator(step.selector);
      switch (step.assertionType) {
        case "toHaveText":
          const text = await element.textContent();
          if (text !== step.expectedValue) {
            throw new Error(`Expected "${step.expectedValue}", got "${text}"`);
          }
          return { assertion: "text matches", actual: text };

        case "toBeVisible":
          const visible = await element.isVisible();
          if (!visible) {
            throw new Error("Element is not visible");
          }
          return { assertion: "element is visible" };

        default:
          throw new Error(`Unknown assertion: ${step.assertionType}`);
      }

    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}
app.get("/get-dom", async (req, res) => {
  const url = req.query.url;

  if (!url || typeof url !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid 'url' parameter" });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.goto(url, { timeout: 20000, waitUntil: "networkidle" });

    // ✅ Lấy toàn bộ DOM
    const fullDom = await page.content();

    await browser.close();

    return res.json({
      url,
      html: fullDom,
    });
  } catch (error) {
    if (browser) {
      await browser
        .close()
        .catch((e) => console.error("Error closing browser:", e));
    }
    return res.status(500).json({
      error: "Failed to retrieve DOM",
      message: error.message,
      callLog: error.stack || "No call log available",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Playwright Service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🐳 Environment: ${process.env.NODE_ENV || "development"}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});
