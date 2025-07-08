import React, { useState } from 'react';
import './Home.css';

const Home = () => {
  const [meetingTopic, setMeetingTopic] = useState('');

  return (
    <div className="home-container">
      <div className="content-center">
        {/* Logo/Title */}
        <div className="logo-container">
          <div className="title-wrapper">
            <h1 className="sweet-title">
              <span data-text="Sahre">Sahre</span>
            </h1>
            <span className="subtitle">Real-time meeting intelligence</span>
          </div>
        </div>

        {/* Main Input Area */}
        <div className="input-container">
          <textarea 
            className="main-textarea"
            placeholder="Enter meeting topic..."
            value={meetingTopic}
            onChange={(e) => setMeetingTopic(e.target.value)}
            rows={4}
          />
        </div>

        {/* Tags Section */}
        <div className="tags-container">
          <div className="tag-item">
            <span className="tag-icon">📊</span>
            <span className="tag-text">Real-time Analysis</span>
          </div>
          <div className="tag-item">
            <span className="tag-icon">💬</span>
            <span className="tag-text">Conversation Cards</span>
          </div>
          <div className="tag-item">
            <span className="tag-icon">🎯</span>
            <span className="tag-text">Meeting Insights</span>
          </div>
          <div className="tag-item">
            <span className="tag-icon">⚡</span>
            <span className="tag-text">Live Updates</span>
          </div>
          <div className="tag-item">
            <span className="tag-icon">📝</span>
            <span className="tag-text">Smart Notes</span>
          </div>
          <div className="tag-item">
            <span className="tag-icon">🔄</span>
            <span className="tag-text">Action Items</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
