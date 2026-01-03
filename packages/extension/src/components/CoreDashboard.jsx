// CORE Dashboard - XP by dApp, Activity, Leaderboard
import { logger } from '@x1-wallet/core';
import React, { useState, useEffect } from 'react';

const CORE_API = "https://core.x1.xyz/api";

export default function CoreDashboard({ wallet }) {
  const [loading, setLoading] = useState(true);
  const [xpData, setXpData] = useState({
    totalScore: 0,
    totalCurrentScore: 0,
    totalClaimedScore: 0,
    level: 1,
    rank: 0,
    nextLevel: 1000
  });

  const [dappXP, setDappXP] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  // Calculate level from XP (every 1000 XP = 1 level)
  const calculateLevel = (xp) => Math.floor(xp / 1000) + 1;
  const calculateNextLevel = (level) => level * 1000;

  // Fetch XP data from CORE API
  useEffect(() => {
    const fetchXPData = async () => {
      const publicKey = wallet?.wallet?.publicKey;
      if (!publicKey) {
        setLoading(false);
        return;
      }

      setLoading(true);
      
      try {
        // Fetch user's XP balance
        const params = new URLSearchParams({
          user: publicKey,
          network: wallet?.network || 'X1 Mainnet'
        });
        
        const response = await fetch(`${CORE_API}/score?${params.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            const totalScore = result.data.totalScore || 0;
            const level = calculateLevel(totalScore);
            setXpData({
              totalScore: totalScore,
              totalCurrentScore: result.data.totalCurrentScore || 0,
              totalClaimedScore: result.data.totalClaimedScore || 0,
              level: level,
              rank: result.data.rank || 0,
              nextLevel: calculateNextLevel(level)
            });
          }
        }

        // Fetch XP breakdown by dApp/category
        try {
          const breakdownResponse = await fetch(`${CORE_API}/score/breakdown?${params.toString()}`, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          
          if (breakdownResponse.ok) {
            const breakdownResult = await breakdownResponse.json();
            if (breakdownResult.success && breakdownResult.data) {
              // Map categories to dApp display
              const categoryMap = {
                swap: { name: 'XDEX', icon: '🔄', color: '#0274fb' },
                send: { name: 'Transfers', icon: '📤', color: '#14F195' },
                stake: { name: 'Staking', icon: '💎', color: '#9945FF' },
                bridge: { name: 'Bridge', icon: '🌉', color: '#ff6b6b' },
                connect: { name: 'Connections', icon: '🔗', color: '#00d26a' },
              };
              
              const dappList = Object.entries(breakdownResult.data)
                .map(([category, xp]) => ({
                  ...categoryMap[category] || { name: category, icon: '⚡', color: '#666' },
                  xp: xp || 0
                }))
                .filter(d => d.xp > 0)
                .sort((a, b) => b.xp - a.xp);
              
              setDappXP(dappList);
            }
          }
        } catch (e) {
          logger.warn('[CoreDashboard] Failed to fetch XP breakdown:', e);
        }

        // Fetch recent activity
        try {
          const activityResponse = await fetch(`${CORE_API}/score/history?${params.toString()}&limit=5`, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          
          if (activityResponse.ok) {
            const activityResult = await activityResponse.json();
            if (activityResult.success && activityResult.data) {
              const activities = activityResult.data.map(item => ({
                action: formatAction(item.category, item.action),
                xp: item.score || item.xp || 0,
                time: formatTimeAgo(item.timestamp || item.createdAt),
                dapp: item.category
              }));
              setRecentActivity(activities);
            }
          }
        } catch (e) {
          logger.warn('[CoreDashboard] Failed to fetch activity:', e);
        }

        // Fetch leaderboard
        try {
          const leaderboardResponse = await fetch(`${CORE_API}/leaderboard?network=${wallet?.network || 'X1 Mainnet'}&limit=5`, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          
          if (leaderboardResponse.ok) {
            const leaderboardResult = await leaderboardResponse.json();
            if (leaderboardResult.success && leaderboardResult.data) {
              const leaders = leaderboardResult.data.map((entry, index) => ({
                rank: index + 1,
                address: formatAddress(entry.user || entry.address),
                xp: entry.totalScore || entry.score || 0
              }));
              setLeaderboard(leaders);
            }
          }
        } catch (e) {
          logger.warn('[CoreDashboard] Failed to fetch leaderboard:', e);
        }

      } catch (error) {
        logger.error('[CoreDashboard] Failed to fetch XP data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchXPData();
  }, [wallet?.wallet?.publicKey, wallet?.network]);

  const formatAction = (category, action) => {
    const actionLabels = {
      swap: 'Swap on XDEX',
      send: 'Sent tokens',
      transfer: 'Transferred tokens',
      stake: 'Staked XNT',
      unstake: 'Unstaked XNT',
      bridge: 'Bridged assets',
      connect: 'Connected dApp'
    };
    return actionLabels[action] || actionLabels[category] || `${category} - ${action}`;
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'recently';
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diff = now - time;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  const progressPercent = xpData.nextLevel > 0 
    ? ((xpData.totalScore % 1000) / 1000) * 100 
    : 0;
  const maxDappXP = dappXP.length > 0 ? Math.max(...dappXP.map(d => d.xp)) : 1;

  const getRankBadge = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const formatAddress = (addr) => {
    if (!addr) return '...';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="core-dashboard">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 20px' }}>
          <div className="spinner" style={{ marginBottom: 16 }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading XP data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="core-dashboard">
      {/* Total XP Card */}
      <div className="core-total-xp">
        <div className="total-xp-main">
          <div className="total-xp-value">{xpData.totalScore.toLocaleString()}</div>
          <div className="total-xp-label">Total XP</div>
        </div>
        <div className="total-xp-meta">
          <div className="xp-meta-item">
            <span className="meta-value">Lv.{xpData.level}</span>
            <span className="meta-label">Level</span>
          </div>
          <div className="xp-meta-item">
            <span className="meta-value">{xpData.rank > 0 ? `#${xpData.rank}` : '-'}</span>
            <span className="meta-label">Rank</span>
          </div>
        </div>
        <div className="xp-progress-container">
          <div className="xp-progress-bar">
            <div className="xp-progress-fill" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
          </div>
          <div className="xp-progress-text">
            {xpData.nextLevel - (xpData.totalScore % 1000)} XP to Level {xpData.level + 1}
          </div>
        </div>
      </div>

      {/* XP by dApp */}
      {dappXP.length > 0 && (
        <div className="core-section">
          <h3 className="section-title">XP by Category</h3>
          <div className="dapp-xp-list">
            {dappXP.map((dapp, i) => (
              <div key={i} className="dapp-xp-item">
                <div className="dapp-info">
                  <span className="dapp-icon" style={{ background: `${dapp.color}20`, color: dapp.color }}>{dapp.icon}</span>
                  <span className="dapp-name">{dapp.name}</span>
                </div>
                <div className="dapp-xp-bar-container">
                  <div className="dapp-xp-bar">
                    <div 
                      className="dapp-xp-fill" 
                      style={{ 
                        width: `${(dapp.xp / maxDappXP) * 100}%`,
                        background: dapp.color 
                      }} 
                    />
                  </div>
                  <span className="dapp-xp-value">{dapp.xp.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <div className="core-section">
          <h3 className="section-title">Recent Activity</h3>
          <div className="activity-list">
            {recentActivity.map((activity, i) => (
              <div key={i} className="activity-item">
                <div className="activity-info">
                  <span className="activity-action">{activity.action}</span>
                  <span className="activity-time">{activity.time}</span>
                </div>
                <span className="activity-xp">+{activity.xp} XP</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {leaderboard.length > 0 && (
        <div className="core-section">
          <div className="section-header">
            <h3 className="section-title">Leaderboard</h3>
            <span className="section-badge">Top {leaderboard.length}</span>
          </div>
          
          <div className="leaderboard-list">
            {leaderboard.map((entry, i) => (
              <div key={i} className={`leaderboard-item ${entry.rank <= 3 ? 'top-three' : ''}`}>
                <span className="lb-rank">{getRankBadge(entry.rank)}</span>
                <span className="lb-address">{entry.address}</span>
                <span className="lb-xp">{(entry.xp / 1000).toFixed(1)}K</span>
              </div>
            ))}
          </div>

          {/* Your Position */}
          <div className="leaderboard-you">
            <span className="lb-rank">{xpData.rank > 0 ? `#${xpData.rank}` : '-'}</span>
            <span className="lb-address">You ({formatAddress(wallet?.wallet?.publicKey)})</span>
            <span className="lb-xp">{(xpData.totalScore / 1000).toFixed(1)}K</span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && xpData.totalScore === 0 && dappXP.length === 0 && (
        <div className="core-section" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
          <h3 style={{ marginBottom: 8, color: 'var(--text-primary)' }}>Start Earning XP!</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Swap, stake, send tokens and more to earn XP and climb the leaderboard.
          </p>
        </div>
      )}
    </div>
  );
}
