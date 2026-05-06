import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { showNotification } from '../../utils/notifications';
import govSeal from '../../assets/images/motherson2.png';
import cgmsclLogo from '../../assets/images/company_logo-01.jpg';
import './Login.css';

const TABS = [
  { id: 'Admin',          label: 'Admin',          usertype: 'HOD'   },
  { id: 'CGMSCL-HO',     label: 'CGMSCL-HO',     usertype: 'HO'    },
  { id: 'Warehouse',      label: 'Warehouse',      usertype: 'WH'    },
  { id: 'Infrastructure', label: 'Infrastructure', usertype: 'INFRA' },
  { id: 'Development',    label: 'Development',    usertype: null    },
];

const MASTER_URL = 'https://dpdmis.in/CGMSCHO_API2/api/Master/masddlUser';

async function fetchUsersForTab(usertype) {
  const res = await fetch(`${MASTER_URL}?Usertype=${usertype}`);
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  const data = await res.json();
  return data.map(u => ({ id: u.userid, name: u.textfield }));
}

const PLACEHOLDER = {
  'Admin':          'Choose Admin',
  'CGMSCL-HO':     'Choose CGMSCL User',
  'Warehouse':      'Choose Warehouse',
  'Infrastructure': 'Select Engineer',
};

const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCaptcha(len = 6) {
  return Array.from({ length: len }, () =>
    CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]
  ).join('');
}

const BASE = 'https://dpdmis.in/CGMSCHO_API2/api/Login';

async function apiSendOTP(userid, ipAddress) {
  const url = `${BASE}/getOTPSaved?userid=${userid}&ipAddress=${encodeURIComponent(ipAddress)}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { message: text }; }
}

async function apiVerifyOTP(otp, userid) {
  const res = await fetch(`${BASE}/VerifyOTPLogin?otp=${otp}&userid=${userid}`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { message: text }; }
}

function Login() {
  const { loginWithOTP } = useAuth();

  const [activeTab, setActiveTab]         = useState('Admin');
  const [selectedUser, setSelectedUser]   = useState('');
  const [otp, setOtp]                     = useState('');
  const [otpSent, setOtpSent]             = useState(false);
  const [otpTimer, setOtpTimer]           = useState(0);
  const [captchaText, setCaptchaText]     = useState(generateCaptcha());
  const [captchaInput, setCaptchaInput]   = useState('');
  const [isLoading, setIsLoading]         = useState(false);
  const [error, setError]                 = useState('');
  const [info, setInfo]                   = useState('');
  const [dropdownOpen, setDropdownOpen]   = useState(false);
  const [users, setUsers]                 = useState([]);
  const [usersLoading, setUsersLoading]   = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const tab = TABS.find(t => t.id === activeTab);
    if (!tab) return;
    if (!tab.usertype) {
      setUsers([]);
      setUsersLoading(false);
      return;
    }
    setUsersLoading(true);
    setUsers([]);
    fetchUsersForTab(tab.usertype)
      .then(list => setUsers(list))
      .catch(err => {
        console.error('[Login] Failed to fetch users:', err);
        setError('Could not load user list. Please refresh.');
      })
      .finally(() => setUsersLoading(false));
  }, [activeTab]);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (otpTimer <= 0) return;
    const id = setInterval(() => setOtpTimer(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [otpTimer]);

  useEffect(() => {
    const container = document.querySelector('.lp-bg');
    if (!container) return;
    for (let i = 0; i < 45; i++) {
      const p = document.createElement('div');
      p.className = 'lp-particle';
      p.style.left = `${Math.random() * 100}%`;
      p.style.top  = `${60 + Math.random() * 40}%`;
      p.style.animationDelay    = `${Math.random() * 18}s`;
      p.style.animationDuration = `${12 + Math.random() * 10}s`;
      p.style.width  = `${1 + Math.random() * 2}px`;
      p.style.height = p.style.width;
      container.appendChild(p);
    }
  }, []);

  const resetForm = useCallback((tab) => {
    setActiveTab(tab);
    setSelectedUser('');
    setOtp('');
    setOtpSent(false);
    setError('');
    setInfo('');
    setDropdownOpen(false);
    setSearchQuery('');
  }, []);

  const refreshCaptcha = () => {
    setCaptchaText(generateCaptcha());
    setCaptchaInput('');
  };

  const handleGenerateOTP = async () => {
    setError(''); setInfo('');
    if (!selectedUser) { setError('Please select a user.'); return; }
    setIsLoading(true);
    try {
      const data = await apiSendOTP(Number(selectedUser), '192.168.1.29');
      setOtpSent(true);
      setOtpTimer(120);
      setInfo(data?.message || 'OTP sent to your registered mobile number.');
      showNotification('OTP sent!', 'success');
    } catch (err) {
      setError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!selectedUser)      { setError('Please select a user.'); return; }
    if (!otp.trim())        { setError('Please enter the OTP.'); return; }
    if (!captchaInput.trim()){ setError('Please enter the CAPTCHA.'); return; }
    if (captchaInput.trim().toUpperCase() !== captchaText) {
      setError('CAPTCHA does not match. Please try again.');
      refreshCaptcha(); return;
    }
    setIsLoading(true);
    try {
      const data = await apiVerifyOTP(otp.trim(), Number(selectedUser));
      const msg  = (data?.message || '').toString().trim().toLowerCase();
      const ok   = data?.status === true || data?.Status === true ||
                   data?.success === true || data?.isValid === true ||
                   msg === 'true' || msg === 'success' || msg === 'verified' || msg === 'valid';
      if (ok) {
        const selectedUserObj = users.find(u => String(u.id) === String(selectedUser)) || {};
        const result = loginWithOTP({
          userid:    selectedUserObj.id,
          textfield: selectedUserObj.name,
          ...data
        });
        if (result?.success !== false) {
          showNotification('Login successful! Welcome to CGMSCL GPT Platform.', 'success');
        } else {
          setError(result.error || 'Login failed.');
        }
      } else {
        setError(data?.message || data?.Message || 'Invalid OTP. Please try again.');
        refreshCaptcha();
      }
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = async (e) => {
    if (activeTab === 'Development') {
      e.preventDefault();
      return;
    }
    await handleLogin(e);
  };

  const handleDevBypassLogin = () => {
    setError('');
    setInfo('');
    setIsLoading(true);
    try {
      const result = loginWithOTP({
        userid: 'dev_ailifebot',
        textfield: 'AILIFEBOT',
        rolename: 'Dev',
      });
      if (result?.success !== false) {
        // Dev login transitions immediately; avoid success popup overlay.
      } else {
        setError(result?.error || 'Development login failed.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const filteredUsers = searchQuery.trim()
    ? users.filter(u => u.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : users;

  return (
    <div className="lp-page">
      <div className="lp-bg">
        <div className="lp-orb lp-orb--1"></div>
        <div className="lp-orb lp-orb--2"></div>
        <div className="lp-orb lp-orb--3"></div>
      </div>

      {/* ── Header ── */}
      <header className="lp-header">
        <div className="lp-header-logo lp-header-logo--left">
          <img src={govSeal} alt="Govt Seal" className="lp-logo-img lp-logo-img--seal" />
        </div>
        <div className="lp-header-center">
          <h1 className="lp-header-title">CGMSCL GPT Platform</h1>
          <p className="lp-header-sub">AI-Powered Medical Inventory & Procurement Analytics</p>
        </div>
        <div className="lp-header-logo lp-header-logo--right">
          <img src={cgmsclLogo} alt="CGMSCL Logo" className="lp-logo-img lp-logo-img--cgmscl" />
        </div>
      </header>

      {/* ── Login Card ── */}
      <main className="lp-main">
        <div className="lp-card">

          {/* Welcome */}
          <div className="lp-welcome">
            <div className="lp-welcome-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12z"/>
                <path d="M3.6 21.6c0-4.6 3.8-8.4 8.4-8.4s8.4 3.8 8.4 8.4"/>
              </svg>
              <span className="lp-welcome-dot"></span>
            </div>
            <div className="lp-welcome-text">
              <h2 className="lp-welcome-title">Welcome Back!</h2>
              <p className="lp-welcome-sub">Sign in to access the CGMSCL AI Platform</p>
            </div>
          </div>

          {/* Tabs */}
          <div className={`lp-tabs${TABS.length > 4 ? ' lp-tabs--compact' : ''}`}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`lp-tab${activeTab === tab.id ? ' lp-tab--active' : ''}`}
                onClick={() => resetForm(tab.id)}
                type="button"
              >{tab.label}</button>
            ))}
          </div>

          {/* Form */}
          <form className="lp-form" onSubmit={handleFormSubmit}>

            {error && (
              <div className="lp-banner lp-banner--error">
                <span className="lp-banner-icon">⚠</span> {error}
              </div>
            )}
            {info && !error && (
              <div className="lp-banner lp-banner--info">
                <span className="lp-banner-icon">✓</span> {info}
              </div>
            )}

            {activeTab === 'Development' ? (
              <div className="lp-field">
                <div className="lp-banner lp-banner--info">
                  <span className="lp-banner-icon">i</span>
                  Development pass login for internal testing.
                </div>
                <button
                  type="button"
                  className="lp-btn-dev-pass"
                  onClick={handleDevBypassLogin}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <><span className="lp-spinner lp-spinner--white"></span>Signing in…</>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="10" rx="2"/>
                        <circle cx="12" cy="16" r="1"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                      Sign in with Development Pass
                    </>
                  )}
                </button>
              </div>
            ) : (
              <>
                {/* User Dropdown */}
                <div className="lp-field">
                  <div className="lp-dropdown" ref={dropdownRef}>
                    <button
                      type="button"
                      className={`lp-dropdown-trigger${dropdownOpen ? ' lp-dropdown-trigger--open' : ''}${!selectedUser ? ' lp-dropdown-trigger--placeholder' : ''}`}
                      onClick={() => !isLoading && !usersLoading && setDropdownOpen(o => !o)}
                      disabled={isLoading || usersLoading}
                    >
                      {usersLoading ? (
                        <>
                          <span className="lp-spinner lp-spinner--green"></span>
                          <span className="lp-dropdown-label" style={{ color: '#9ca3af' }}>Loading users…</span>
                        </>
                      ) : (
                        <>
                          <svg className="lp-dropdown-user-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                          </svg>
                          <span className="lp-dropdown-label">
                            {selectedUser
                              ? users.find(u => String(u.id) === String(selectedUser))?.name || PLACEHOLDER[activeTab]
                              : PLACEHOLDER[activeTab]}
                          </span>
                          <svg className={`lp-dropdown-chevron${dropdownOpen ? ' lp-dropdown-chevron--up' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </>
                      )}
                    </button>

                    {dropdownOpen && (
                      <div className="lp-dropdown-panel">
                        <div className="lp-dropdown-search">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                          </svg>
                          <input
                            type="text"
                            className="lp-dropdown-search-input"
                            placeholder="Search user..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            autoFocus
                          />
                        </div>
                        <ul className="lp-dropdown-list">
                          {filteredUsers.length === 0 ? (
                            <li className="lp-dropdown-empty">No users found</li>
                          ) : filteredUsers.map(u => (
                            <li
                              key={u.id}
                              className={`lp-dropdown-item${String(u.id) === String(selectedUser) ? ' lp-dropdown-item--active' : ''}`}
                              onClick={() => {
                                setSelectedUser(String(u.id));
                                setOtpSent(false);
                                setOtp('');
                                setError('');
                                setDropdownOpen(false);
                                setSearchQuery('');
                              }}
                            >
                              {String(u.id) === String(selectedUser) && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                              {u.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  {!selectedUser && (
                    <span className="lp-hint">Please select your user account</span>
                  )}
                </div>

                {/* Generate OTP */}
                <div className="lp-otp-row">
                  <div className="lp-field" style={{ flex: 1, margin: 0 }}>
                    <input
                      type="text"
                      className="lp-input"
                      placeholder="Enter OTP"
                      value={otp}
                      onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      disabled={isLoading}
                      maxLength={8}
                      autoComplete="one-time-code"
                    />
                  </div>
                  <button
                    type="button"
                    className="lp-btn-otp"
                    onClick={handleGenerateOTP}
                    disabled={isLoading || !selectedUser || otpTimer > 0}
                  >
                    {isLoading && !otpSent
                      ? <><span className="lp-spinner"></span>Sending…</>
                      : otpTimer > 0
                        ? `Resend in ${otpTimer}s`
                        : 'Send OTP'}
                  </button>
                </div>

                {/* CAPTCHA */}
                <div className="lp-field">
                  <label className="lp-captcha-label">Security CAPTCHA</label>
                  <div className="lp-captcha-row">
                    <span className="lp-captcha-box">{captchaText}</span>
                    <button type="button" className="lp-captcha-refresh" onClick={refreshCaptcha} title="Refresh CAPTCHA">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                      </svg>
                      Refresh
                    </button>
                  </div>
                  <input
                    type="text"
                    className="lp-input"
                    style={{ marginTop: 8 }}
                    placeholder="Enter CAPTCHA above"
                    value={captchaInput}
                    onChange={e => setCaptchaInput(e.target.value.toUpperCase())}
                    disabled={isLoading}
                    maxLength={6}
                    autoComplete="off"
                  />
                </div>

                {/* Login Button */}
                <button
                  type="submit"
                  className="lp-btn-login"
                  disabled={isLoading || !selectedUser || !otp || !captchaInput}
                >
                  {isLoading && otpSent
                    ? <><span className="lp-spinner lp-spinner--white"></span>Verifying…</>
                    : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                        </svg>
                        Sign in via OTP
                      </>
                    )}
                </button>
              </>
            )}

          </form>

          <p className="lp-footer-note">
            Secure access — your OTP is sent to your registered mobile number
          </p>
        </div>
      </main>
    </div>
  );
}

export default Login;
