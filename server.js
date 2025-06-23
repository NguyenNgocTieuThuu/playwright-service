const express = require('express');
const { chromium, firefox, webkit } = require('playwright');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main test execution endpoint
app.post('/execute-test', async (req, res) => {
  const { testCase, browserType = 'chromium', headless = true } = req.body;
  
  let browser;
  try {
    // Launch browser
    const browserEngine = getBrowserEngine(browserType);
    browser = await browserEngine.launch({ 
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Railway compatibility
    });
    
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    
    const results = [];
    
    // Execute test steps
    for (const [index, step] of testCase.steps.entries()) {
      try {
        const stepResult = await executeStep(page, step);
        results.push({
          stepIndex: index,
          step: step.description || `Step ${index + 1}`,
          status: 'passed',
          result: stepResult
        });
      } catch (error) {
        results.push({
          stepIndex: index,
          step: step.description || `Step ${index + 1}`,
          status: 'failed',
          error: error.message
        });
        
        // Take screenshot on failure
        if (step.screenshotOnFail !== false) {
          const screenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: true 
          });
          results[results.length - 1].screenshot = screenshot;
        }
        
        // Continue or stop on failure
        if (step.stopOnFail !== false) {
          break;
        }
      }
    }
    
    await browser.close();
    
    const overallStatus = results.every(r => r.status === 'passed') ? 'passed' : 'failed';
    
    res.json({
      testName: testCase.name,
      status: overallStatus,
      duration: Date.now() - startTime,
      results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    if (browser) await browser.close();
    
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Batch test execution
app.post('/execute-batch', async (req, res) => {
  const { testCases, browserType = 'chromium' } = req.body;
  const results = [];
  
  for (const testCase of testCases) {
    try {
      const result = await executeTestCase(testCase, browserType);
      results.push(result);
    } catch (error) {
      results.push({
        testName: testCase.name,
        status: 'error',
        error: error.message
      });
    }
  }
  
  res.json({
    batchStatus: 'completed',
    totalTests: testCases.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    results
  });
});

// Helper functions
function getBrowserEngine(browserType) {
  switch (browserType.toLowerCase()) {
    case 'firefox': return firefox;
    case 'webkit': return webkit;
    case 'safari': return webkit;
    default: return chromium;
  }
}

async function executeStep(page, step) {
  const startTime = Date.now();
  
  switch (step.action.toLowerCase()) {
    case 'goto':
      await page.goto(step.url, { waitUntil: 'networkidle' });
      return { url: page.url() };
      
    case 'click':
      await page.click(step.selector);
      return { clicked: step.selector };
      
    case 'fill':
    case 'type':
      await page.fill(step.selector, step.value);
      return { filled: step.selector, value: step.value };
      
    case 'select':
      await page.selectOption(step.selector, step.value);
      return { selected: step.selector, value: step.value };
      
    case 'wait':
      if (step.selector) {
        await page.waitForSelector(step.selector, { timeout: step.timeout || 30000 });
      } else {
        await page.waitForTimeout(step.timeout || 1000);
      }
      return { waited: step.timeout || 'for selector' };
      
    case 'screenshot':
      const screenshot = await page.screenshot({ 
        encoding: 'base64',
        fullPage: step.fullPage || false 
      });
      return { screenshot };
      
    case 'expect':
    case 'assert':
      return await executeAssertion(page, step);
      
    case 'scroll':
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      return { scrolled: 'to bottom' };
      
    case 'hover':
      await page.hover(step.selector);
      return { hovered: step.selector };
      
    case 'press':
      await page.press(step.selector || 'body', step.key);
      return { pressed: step.key };
      
    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}

async function executeAssertion(page, step) {
  const element = step.selector ? page.locator(step.selector) : page;
  
  switch (step.assertionType) {
    case 'toHaveText':
      await expect(element).toHaveText(step.expectedValue);
      return { assertion: 'text matches', value: step.expectedValue };
      
    case 'toBeVisible':
      await expect(element).toBeVisible();
      return { assertion: 'element is visible' };
      
    case 'toHaveURL':
      await expect(page).toHaveURL(step.expectedValue);
      return { assertion: 'URL matches', value: step.expectedValue };
      
    case 'toHaveTitle':
      await expect(page).toHaveTitle(step.expectedValue);
      return { assertion: 'title matches', value: step.expectedValue };
      
    default:
      throw new Error(`Unknown assertion: ${step.assertionType}`);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(` Playwright Service running on port ${PORT}`);
  console.log(` Health check: http://localhost:${PORT}/health`);
});