const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents");
const settings = require("./config/config.js");
const { sleep, loadData, getRandomNumber, saveToken, isTokenExpired, saveJson, getRandomElement } = require("./utils/utils.js");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./checkAPI");
const { headers } = require("./core/header.js");
const { showBanner } = require("./core/banner.js");
const localStorage = require("./localStorage.json");
const ethers = require("ethers");
const { solveCaptcha } = require("./utils/captcha.js");
const { swapSETH_YBTC, stakeYU, swapYBTC_YU, checkBalance } = require("./utils/contract.js");

// const refcodes = loadData("reffCodes.txt");
let REF_CODE = settings.REF_CODE;
class ClientAPI {
  constructor(itemData, accountIndex, proxy, baseURL, authInfos) {
    this.headers = headers;
    this.baseURL = baseURL;
    this.baseURL_v2 = "";
    this.localItem = null;
    this.itemData = itemData;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.token = null;
    this.localStorage = localStorage;
    this.wallet = new ethers.Wallet(this.itemData.privateKey);
    // this.w3 = new Web3(new Web3.providers.HttpProvider(settings.RPC_URL, proxy));
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      this.session_name = this.itemData.address;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const accountPrefix = `[Yala][${this.accountIndex + 1}][${this.itemData.address}][${REF_CODE}]`;
    let ipPrefix = "[Local IP]";
    if (settings.USE_PROXY) {
      ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    }
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(
    url,
    method,
    data = {},
    options = {
      retries: 1,
      isAuth: false,
    }
  ) {
    const { retries, isAuth } = options;

    const headers = {
      ...this.headers,
      ...(this.localItem?.cookie ? { cookie: this.localItem.cookie } : {}),
    };

    if (!isAuth && this.token) {
      headers["authorization"] = `Bearer ${this.token}`;
    } else {
      headers["authorization"] = `Bearer ${null}`;
    }

    let proxyAgent = null;
    if (settings.USE_PROXY) {
      proxyAgent = new HttpsProxyAgent(this.proxy);
    }

    let currRetries = 0,
      errorMessage = "",
      errorStatus = 0;

    do {
      try {
        const requestData =
          method.toLowerCase() !== "get"
            ? data // Convert data to query string format
            : undefined;

        const response = await axios({
          method,
          url: `${url}`,
          headers: {
            ...headers,
          },
          timeout: 120000,
          ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent } : {}),
          ...(method.toLowerCase() !== "get" ? { data: requestData } : {}),
        });

        if (response?.data?.msg !== "ok") {
          if (response.data.code == 100 && url.includes("/login")) {
            this.log(`Ref code ${REF_CODE} has reached the limit, change another ref`, "warning");
            await sleep(1);
            process.exit(0);
            // const refIndex = refcodes.findIndex((e) => e == refcodes);
            // if (refIndex === refcodes.length) {
            //   this.log(`Ref code ${REF_CODE} has reached the limit, change another ref`, "warning");
            //   await sleep(1);
            //   process.exit(0);
            // } else {
            //   this.log(`Ref code ${REF_CODE} has reached the limit, change another ref ${refcodes[refIndex + 1]}`, "warning");
            //   REF_CODE = refcodes[refIndex + 1];
            //   return this.makeRequest(url, method, data, options);
            // }
          }
          return { status: response.data.code, success: false, data: response.data.data, error: response.data };
        }
        if (response?.data?.data) return { status: response.status, success: true, data: response.data.data };
        return { success: true, data: response.data, status: response.status };
      } catch (error) {
        errorMessage = error?.response?.data?.error || error.message;
        errorStatus = error.status;
        this.log(`Request failed: ${url} | ${JSON.stringify(errorMessage)}...`, "warning");

        if (error.status === 401) {
          const token = await this.getValidToken(true);
          if (!token) {
            process.exit(1);
          }
          this.token = token;
          return this.makeRequest(url, method, data, options);
        }
        if (error.status === 400) {
          this.log(`Invalid request for ${url}, maybe have new update from server | contact: https://t.me/airdrophuntersieutoc to get new update!`, "error");
          return { success: false, status: error.status, error: errorMessage, data: null };
        }
        if (error.status === 429) {
          this.log(`Rate limit ${error.message}, waiting 30s to retries`, "warning");
          await sleep(60);
        }
        await sleep(settings.DELAY_BETWEEN_REQUESTS);
        currRetries++;
        if (currRetries > retries) {
          return { status: error.status, success: false, error: errorMessage, data: null };
        }
      }
    } while (currRetries <= retries);

    return { status: errorStatus, success: false, error: errorMessage, data: null };
  }

  getCookieData(setCookie) {
    try {
      if (!(setCookie?.length > 0)) return null;
      let cookie = [];
      const item = JSON.stringify(setCookie);
      // const item =
      const nonceMatch = item.match(/user=([^;]+)/);
      if (nonceMatch && nonceMatch[0]) {
        cookie.push(nonceMatch[0]);
      }

      const data = cookie.join(";");
      return cookie.length > 0 ? data : null;
    } catch (error) {
      this.log(`Error get cookie: ${error.message}`, "error");
      return null;
    }
  }

  async auth() {
    const res = await this.getNonce();
    if (!res?.data?.hmac) return { success: false, error: "Can't get hmac" };
    const signedMessage = await this.wallet.signMessage(res.data.tips);

    const payload = {
      ...res.data,
      signature: signedMessage,
      fatherInviteCode: REF_CODE,
    };

    return this.makeRequest(`${this.baseURL}/account/login`, "post", payload, { isAuth: true });
  }

  async getNonce() {
    return this.makeRequest(
      `${this.baseURL}/account/challenge`,
      "post",
      {
        address: this.itemData.address,
        chain: 11155111,
      },
      { isAuth: true }
    );
  }

  async getUserData() {
    return this.makeRequest(`${this.baseURL}/account/info`, "get");
  }

  async getBalance() {
    return this.makeRequest(`${this.baseURL}/points/myPoints?chain=11155111`, "get");
  }

  async getInfoCaptain() {
    return this.makeRequest(`${this.baseURL}/captain/info`, "get");
  }

  async bindCode() {
    return this.makeRequest(`${this.baseURL}/account/joinFather`, "post", { fatherInviteCode: REF_CODE });
  }
  async checkin() {
    return this.makeRequest(`${this.baseURL}/points/dailyCollector`, "post");
  }

  async openBox() {
    return this.makeRequest(`${this.baseURL}/captain/openBlindBox`, "post");
  }

  async faucet() {
    this.log(`Solving captcha...`);
    const captchaToken = await solveCaptcha();
    if (!captchaToken) {
      return { success: false };
    }
    return this.makeRequest(`${this.baseURL}/faucet/send`, "post", {
      "cf-turnstile-response": captchaToken,
      tick: "ETH",
      amount: "0.01",
    });
  }

  async getValidToken(isNew = false) {
    const existingToken = this.token;
    const { isExpired: isExp, expirationDate } = isTokenExpired(existingToken);

    this.log(`Access token status: ${isExp ? "Expired".yellow : "Valid".green} | Acess token exp: ${expirationDate}`);
    if (existingToken && !isNew && !isExp) {
      this.log("Using valid token", "success");
      return existingToken;
    }

    this.log("No found token or experied, trying get new token...", "warning");
    const loginRes = await this.auth();
    if (!loginRes.success) {
      this.log(`Auth failed: ${JSON.stringify(loginRes)}`, "error");
      return null;
    }
    const newToken = loginRes.data;
    if (newToken?.tokenAccess) {
      await saveJson(this.session_name, JSON.stringify(newToken), "localStorage.json");
      this.localItem = newToken;
      return newToken.tokenAccess;
    }
    this.log("Can't get new token...", "warning");
    return null;
  }

  async handleFaucet() {
    const res = await this.faucet();
    if (res.success) {
      this.log(`Faucet success!`, "success");
    } else {
      this.log(`Faucet failed: ${JSON.stringify(res)}`, "warning");
    }
  }
  async handleCheckin(userData) {
    const dailyCollectorTime = userData?.dailyCollectorTime;

    const nowUTC = new Date();

    if (!dailyCollectorTime) {
      const resCheckin = await this.checkin();
      if (resCheckin.success) {
        this.log(`Checkin success!`, "success");
      } else {
        this.log(`Failed checkin ${JSON.stringify(resCheckin)}`, "warning");
      }
      return;
    }

    const latestDailyCombo = new Date(dailyCollectorTime);

    const twentyFourHoursAgo = new Date(nowUTC.getTime() - 24 * 60 * 60 * 1000);

    if (latestDailyCombo < twentyFourHoursAgo) {
      const resCheckin = await this.checkin();
      if (resCheckin.success) {
        this.log(`Checkin success!`, "success");
      } else {
        this.log(`Failed checkin ${JSON.stringify(resCheckin)}`, "warning");
      }
    } else {
      return this.log(`You checked in today! Latest checkin: ${latestDailyCombo.toLocaleString()}`, "warning");
    }
  }

  async handleSyncData() {
    this.log(`Sync data...`);
    let userData = { success: false, data: null, status: 0 },
      retries = 0;

    do {
      userData = await this.getUserData();
      if (userData?.success) break;
      retries++;
    } while (retries < 1 && userData.status !== 400);

    const balanceRes = await this.getBalance();
    const captainRes = await this.getInfoCaptain();
    const YTBC = await checkBalance(this.itemData.privateKey, "0xBBd3EDd4D3b519c0d14965d9311185CFaC8c3220");
    const YU = await checkBalance(this.itemData.privateKey, "0xe0232D625Ea3B94698F0a7DfF702931B704083c9");

    if (userData?.success) {
      if (balanceRes.data) {
        userData["data"] = {
          ...userData.data,
          ...balanceRes.data,
          YTBC,
          YU,
        };
      }

      if (captainRes.data) {
        userData["data"] = {
          ...userData.data,
          ...captainRes.data,
        };
      }

      const { totalPoints, inviteCode, followYala, fatherInviteCode, dailyCollectorPoints, yu, mySelf } = userData.data;

      this.log(
        `Ref code: ${inviteCode} | Days checkin: ${dailyCollectorPoints || 0} | YBTC: ${YTBC} | YU: ${YU} | my staked/team staked (YU): ${mySelf?.yu || 0}/${yu || 0} | Total points: ${
          totalPoints || 0
        }`,
        "custom"
      );
      if (!fatherInviteCode) {
        await this.bindCode();
      }
    } else {
      this.log("Can't sync new data...skipping", "warning");
    }
    return userData;
  }

  getTimeUntilNextBoxOpen(lastOpenTimeStr, timeRemain) {
    if (!lastOpenTimeStr) return true;
    const lastOpenTime = new Date(lastOpenTimeStr);
    const now = new Date();
    const timeSinceLastOpen = now - lastOpenTime;
    const timeUntilNextOpen = timeRemain * 60 * 60 * 1000 - timeSinceLastOpen;

    if (timeSinceLastOpen >= timeRemain * 60 * 60 * 1000) {
      return true;
    } else {
      const days = Math.floor(timeUntilNextOpen / (24 * 60 * 60 * 1000));
      const hours = Math.floor((timeUntilNextOpen % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const minutes = Math.floor((timeUntilNextOpen % (60 * 60 * 1000)) / (60 * 1000));
      const seconds = Math.floor((timeUntilNextOpen % (60 * 1000)) / 1000);

      this.log(`Next open time: ${days} days ${hours} hours ${minutes} minutes ${seconds} seconds`, "warning");
      return false;
    }
  }

  async handleOpenBox(userData) {
    const teamSize = userData?.size || 0;
    if (teamSize < 3) return;
    let timeRemain = 72;
    if (teamSize > 20) timeRemain = 72;
    else if (teamSize > 10) timeRemain = 120;
    else timeRemain = 168;
    const boxs = userData?.blindBoxs || [];
    for (const box of boxs) {
      const isOpen = this.getTimeUntilNextBoxOpen(box.openTime, timeRemain);
      if (isOpen) {
        const res = await this.openBox();
        if (res.success) {
          const rw = res.data?.captainRewardPoints || 0;
          this.log(`Open box success! Reward: ${rw.toFixed(2)}`, "success");
        } else {
          this.log(`Open box failed!`, "warning");
        }
      }
    }
  }

  async handleOnchain(userData) {
    // const res = await swapSETH_YBTC(this.itemData.privateKey, 0.1);
    // const res = await swapYBTC_YU(this.itemData.privateKey, 0.03);
    // console.log(res);
    if (settings.AUTO_STAKE && +userData["YU"] > 10) {
      this.log(`Starting stake YU...`);
      let percent = getRandomNumber(settings.PERCENT_STAKE[0], settings.PERCENT_STAKE[1]);
      if (percent > 90) {
        percent = percent - 10;
      }
      const amount = (userData["YU"] * percent) / 100;
      const res = await stakeYU(this.itemData.privateKey, amount.toFixed(2));
      if (res.success) {
        this.log(res.message, "success");
      } else {
        this.log(res.message, "warning");
      }
    }
  }

  async runAccount() {
    const accountIndex = this.accountIndex;
    this.session_name = this.itemData.address;
    this.localItem = JSON.parse(this.localStorage[this.session_name] || "{}");
    this.token = this.localItem?.tokenAccess;
    this.#set_headers();
    if (settings.USE_PROXY) {
      try {
        this.proxyIP = await this.checkProxyIP();
      } catch (error) {
        this.log(`Cannot check proxy IP: ${error.message}`, "warning");
        return;
      }
      const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
      console.log(`=========Tài khoản ${accountIndex + 1} | ${this.proxyIP} | Bắt đầu sau ${timesleep} giây...`.green);
      await sleep(timesleep);
    }

    const token = await this.getValidToken();
    if (!token) return;
    this.token = token;
    // await this.handleOnchain();

    const userData = await this.handleSyncData();
    if (userData.success) {
      if (settings.AUTO_FAUCET) {
        await this.handleFaucet();
      }
      await sleep(1);
      await this.handleCheckin(userData.data);
      await sleep(1);
      await this.handleOpenBox(userData.data);
      await sleep(1);
      await this.handleOnchain(userData.data);
    } else {
      return this.log("Can't get use info...skipping", "error");
    }
  }
}

async function runWorker(workerData) {
  const { itemData, accountIndex, proxy, hasIDAPI, authInfos } = workerData;
  const to = new ClientAPI(itemData, accountIndex, proxy, hasIDAPI, authInfos);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  console.clear();
  showBanner();
  const privateKeys = loadData("privateKeys.txt");
  const proxies = loadData("proxy.txt");
  let authInfos = require("./localStorage.json");

  if (privateKeys.length == 0 || (privateKeys.length > proxies.length && settings.USE_PROXY)) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${privateKeys.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  if (!settings.USE_PROXY) {
    console.log(`You are running bot without proxies!!!`.yellow);
  }
  let maxThreads = settings.USE_PROXY ? settings.MAX_THEADS : settings.MAX_THEADS_NO_PROXY;

  const resCheck = await checkBaseUrl();
  if (!resCheck.endpoint) return console.log(`Không thể tìm thấy ID API, có thể lỗi kết nỗi, thử lại sau!`.red);
  console.log(`${resCheck.message}`.yellow);

  const data = privateKeys.map((val, index) => {
    const prvk = val.startsWith("0x") ? val : `0x${val}`;
    const wallet = new ethers.Wallet(prvk);
    const item = {
      address: wallet.address,
      privateKey: prvk,
    };
    new ClientAPI(item, index, proxies[index], resCheck.endpoint, {}).createUserAgent();
    return item;
  });
  await sleep(1);
  while (true) {
    authInfos = require("./localStorage.json");
    let currentIndex = 0;
    const errors = [];
    while (currentIndex < data.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, data.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI: resCheck.endpoint,
            itemData: data[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
            authInfos: authInfos,
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              if (settings.ENABLE_DEBUG) {
                console.log(message);
              }
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error?.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < data.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    await sleep(3);
    console.log(`=============${new Date().toLocaleString()} | Hoàn thành tất cả tài khoản | Chờ ${settings.TIME_SLEEP} phút=============`.magenta);
    showBanner();
    await sleep(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
