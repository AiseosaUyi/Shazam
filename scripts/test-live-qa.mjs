// scripts/test-live-qa.mjs
const BASE_URL = process.env.TEST_URL || 'https://shazam-opal.vercel.app';

console.log(`\n==================================================`);
console.log(`Starting Live End-to-End Deep QA against: ${BASE_URL}`);
console.log(`==================================================\n`);

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

async function run() {
  let sessionCookie = '';
  let vaultCookie = '';

  // ----------------------------------------------------------------------
  // TEST 1: Check Public HTML and Scrollable Viewport Structure
  // ----------------------------------------------------------------------
  console.log(`\n--- Test 1: Page Scrollability & Layout on /models ---`);
  try {
    const res = await fetch(`${BASE_URL}/models`);
    const html = await res.text();
    assert(res.status === 200, `GET /models returned HTTP 200`);
    assert(html.includes('overflow-y-auto'), `/models contains overflow-y-auto scroll container`);
    assert(html.includes('100% Free') || html.includes('100% FREE TIER'), `/models contains 100% Free badge/filter`);
    assert(html.includes('Connect Free Google Key') || html.includes('API Keys (Free)'), `/models contains link to free API key connection`);
    assert(html.includes('Chat') && html.includes('href="/?model='), `Model cards link directly to Chat with ?model= param`);
  } catch (err) {
    assert(false, `Test 1 failed with error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 2: Catalog API Routes & Free Tier Pricing
  // ----------------------------------------------------------------------
  console.log(`\n--- Test 2: Models API Catalog Verification (/api/v1/catalog) ---`);
  try {
    const res = await fetch(`${BASE_URL}/api/v1/catalog`);
    const data = await res.json();
    assert(res.status === 200, `GET /api/v1/catalog returned HTTP 200`);
    assert(Array.isArray(data.models) && data.models.length > 0, `Returned ${data.models?.length} models`);
    
    const flash38 = data.models.find(m => m.name === 'Gemini 3.8 Flash' || m.id?.includes('flash'));
    assert(!!flash38, `Gemini Flash model present in catalog`);
    
    // Check routes for free tier
    const freeRoutes = (data.routes || []).filter(r => r.costClass === 'verified_free');
    assert(freeRoutes.length > 0, `Catalog exposes ${freeRoutes.length} verified_free routes`);
  } catch (err) {
    assert(false, `Test 2 failed with error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 3: Logged-Out (Guest) UX State Checks
  // ----------------------------------------------------------------------
  console.log(`\n--- Test 3: Logged-Out / Guest UX State Checks ---`);
  try {
    // 3a. /connections as guest
    const guestConnRes = await fetch(`${BASE_URL}/api/v1/credentials`);
    assert(guestConnRes.status === 401, `GET /api/v1/credentials as guest is rejected with 401 Unauthorized`);

    // 3b. /api/v1/auth/me as guest
    const guestMeRes = await fetch(`${BASE_URL}/api/v1/auth/me`);
    const guestMeData = await guestMeRes.json();
    assert(guestMeData.user === null, `GET /api/v1/auth/me as guest returns user: null`);

    // 3c. Sending task as guest
    const guestTaskRes = await fetch(`${BASE_URL}/api/v1/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Hello guest' })
    });
    assert(guestTaskRes.status === 401, `POST /api/v1/tasks as guest is rejected with 401 Unauthorized`);
  } catch (err) {
    assert(false, `Test 3 failed with error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 4: User Authentication & Signed Session Token
  // ----------------------------------------------------------------------
  console.log(`\n--- Test 4: Authentication & Cross-Container Signed Session Token ---`);
  try {
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'aiseosauyiidahor@gmail.com',
        password: 'Password123!'
      })
    });
    const loginData = await loginRes.json();
    assert(loginRes.status === 200, `POST /api/v1/auth/login returned HTTP 200: ${loginData.user?.email || loginData.error}`);
    
    // Extract set-cookie
    const setCookieHeaders = loginRes.headers.getSetCookie 
      ? loginRes.headers.getSetCookie() 
      : [loginRes.headers.get('set-cookie')].filter(Boolean);
    
    const sessionMatch = setCookieHeaders.join('; ').match(/shazam_session=([^;]+)/);
    if (sessionMatch) {
      sessionCookie = `shazam_session=${sessionMatch[1]}`;
      assert(sessionMatch[1].includes('.'), `Session token is cryptographically signed (HMAC dot-separated format)`);
    } else {
      assert(false, `shazam_session cookie received in response headers`);
    }

    // Test GET /api/v1/auth/me with session token
    const meRes = await fetch(`${BASE_URL}/api/v1/auth/me`, {
      headers: { Cookie: sessionCookie }
    });
    const meData = await meRes.json();
    assert(meRes.status === 200, `GET /api/v1/auth/me returns HTTP 200 with active session`);
    assert(meData.user?.email === 'aiseosauyiidahor@gmail.com', `Logged in user verified: ${meData.user?.email}`);
  } catch (err) {
    assert(false, `Test 4 failed with error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 5: Connecting API Key (Vault Encryption & Cookie Durability)
  // ----------------------------------------------------------------------
  console.log(`\n--- Test 5: Save API Key (Vault Fallback & shazam_vault Cookie) ---`);
  try {
    const credRes = await fetch(`${BASE_URL}/api/v1/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie
      },
      body: JSON.stringify({
        providerId: 'google',
        apiKey: 'AIzaSyDemoValidationKeyForQA1234567890Test'
      })
    });
    const credData = await credRes.json();
    assert(credRes.status === 200 || credRes.status === 201, `POST /api/v1/credentials returned HTTP ${credRes.status}`);
    assert(!credData.error || !credData.error.includes('Refusing to encrypt'), `No 'Refusing to encrypt' error!`);

    // Check shazam_vault cookie
    const setCookieHeaders = credRes.headers.getSetCookie 
      ? credRes.headers.getSetCookie() 
      : [credRes.headers.get('set-cookie')].filter(Boolean);
    
    const rawAll = setCookieHeaders.join('; ');
    const vaultMatch = rawAll.match(/shazam_vault=([^;]+)/);
    if (vaultMatch) {
      vaultCookie = `shazam_vault=${vaultMatch[1]}`;
      assert(true, `shazam_vault cookie issued with encrypted credential state (${vaultCookie.slice(0, 35)}...)`);
    } else {
      assert(false, `shazam_vault cookie present in POST /credentials response headers`);
    }
  } catch (err) {
    assert(false, `Test 5 failed with error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 6: Verify Provider Connection Persists in /api/v1/providers
  // ----------------------------------------------------------------------
  console.log(`\n--- Test 6: Verify Provider Connection Persists in /api/v1/providers ---`);
  try {
    const cookies = [sessionCookie, vaultCookie].filter(Boolean).join('; ');
    const provRes = await fetch(`${BASE_URL}/api/v1/providers`, {
      headers: { Cookie: cookies }
    });
    const provData = await provRes.json();
    assert(provRes.status === 200, `GET /api/v1/providers returned HTTP 200`);
    
    const googleProv = (provData.providers || []).find(p => p.id === 'google');
    assert(!!googleProv, `Google provider returned in providers list`);
    assert(googleProv?.isConnected === true, `Google provider isConnected is TRUE across serverless cold start!`);
  } catch (err) {
    assert(false, `Test 6 failed with error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 7: Toggle to Chat & Task Dispatch with Connected Key (SSE Stream)
  // ----------------------------------------------------------------------
  console.log(`\n--- Test 7: Toggle to Chat & Send Message (SSE Task Dispatch) ---`);
  try {
    const cookies = [sessionCookie, vaultCookie].filter(Boolean).join('; ');
    const taskRes = await fetch(`${BASE_URL}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookies
      },
      body: JSON.stringify({
        prompt: 'Say hello in 3 words',
        pinnedModelName: 'Gemini 3.8 Flash',
        costPolicy: 'free_only'
      })
    });
    
    assert(taskRes.status === 200, `POST /api/v1/tasks returned HTTP 200 SSE stream`);
    const contentType = taskRes.headers.get('content-type') || '';
    assert(contentType.includes('text/event-stream'), `Response is text/event-stream`);

    // Read SSE stream
    const reader = taskRes.body.getReader();
    const decoder = new TextDecoder();
    let streamText = '';
    let receivedEvents = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      streamText += chunk;
      
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          receivedEvents.push(line.replace('event: ', '').trim());
        }
      }
    }

    assert(receivedEvents.length > 0, `Received SSE events: [${receivedEvents.join(', ')}]`);
    assert(!streamText.includes('Sign in required'), `No 'Sign in required' error in SSE stream`);
    assert(!streamText.includes('No provider credentials configured') && !streamText.includes('No API keys configured'), 
      `Credentials recognized in tasks lambda container!`);
    
    console.log(`     (Stream preview: ${streamText.slice(0, 150).replace(/\n/g, ' ')}...)`);
  } catch (err) {
    assert(false, `Test 7 failed with error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------------------------
  console.log(`\n==================================================`);
  console.log(`QA Result: ${passedTests}/${totalTests} Tests Passed`);
  console.log(`==================================================\n`);

  if (passedTests < totalTests) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Fatal QA execution error:", err);
  process.exit(1);
});
