import React, { useState, useEffect, useRef } from 'react';

const ArithmeticPracticeApp = () => {
  const [settings, setSettings] = useState({
    addition: { enabled: true, min: 0, max: 10 },
    subtraction: { enabled: true, min: 0, max: 10 },
    multiplication: { enabled: true, min: 0, max: 10 },
    division: { enabled: true, min: 1, max: 10 },
  });
  const [currentProblem, setCurrentProblem] = useState({ question: '', answer: '' });
  const [input, setInput] = useState('');
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isActive, setIsActive] = useState(false);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    const savedSettings = localStorage.getItem('arithmeticSettings');
    const savedHistory = localStorage.getItem('arithmeticHistory');
    if (savedSettings) setSettings(JSON.parse(savedSettings));
    if (savedHistory) setHistory(JSON.parse(savedHistory));
  }, []);

  useEffect(() => {
    localStorage.setItem('arithmeticSettings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('arithmeticHistory', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (isActive) {
      const timer = setInterval(() => {
        setTimeLeft((prevTime) => {
          if (prevTime <= 1) {
            clearInterval(timer);
            setIsActive(false);
            setHistory((prev) => [...prev, { date: new Date().toISOString(), score }]);
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isActive]);

  useEffect(() => {
    if (isActive) {
      generateProblem();
    }
  }, [isActive, score]);

  const generateProblem = () => {
    const operations = Object.entries(settings)
      .filter(([_, value]) => value.enabled)
      .map(([key]) => key);
    
    if (operations.length === 0) {
      setCurrentProblem({ question: 'Please enable at least one operation', answer: '' });
      return;
    }

    const operation = operations[Math.floor(Math.random() * operations.length)];
    const { min, max } = settings[operation];
    let a = Math.floor(Math.random() * (max - min + 1)) + min;
    let b = Math.floor(Math.random() * (max - min + 1)) + min;

    let question, answer;

    switch (operation) {
      case 'addition':
        question = `${a} + ${b}`;
        answer = a + b;
        break;
      case 'subtraction':
        if (b > a) [a, b] = [b, a];
        question = `${a} - ${b}`;
        answer = a - b;
        break;
      case 'multiplication':
        question = `${a} × ${b}`;
        answer = a * b;
        break;
      case 'division':
        answer = a;
        question = `${a * b} ÷ ${b}`;
        break;
    }

    setCurrentProblem({ question, answer: answer.toString() });
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    if (value === currentProblem.answer) {
      setScore((prev) => prev + 1);
      setInput('');
      generateProblem();
    }
  };

  const startPractice = () => {
    setIsActive(true);
    setTimeLeft(60);
    setScore(0);
    setInput('');
    inputRef.current.focus();
  };

  const toggleOperation = (operation) => {
    setSettings((prev) => ({
      ...prev,
      [operation]: { ...prev[operation], enabled: !prev[operation].enabled },
    }));
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <h1>Arithmetic Practice</h1>
      <div>
        <span>Time: {timeLeft}s</span>
        <span style={{ marginLeft: '20px' }}>Score: {score}</span>
      </div>
      <div style={{ fontSize: '24px', margin: '20px 0' }}>{currentProblem.question}</div>
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={handleInputChange}
        placeholder="Enter your answer"
        disabled={!isActive}
        style={{ width: '100%', padding: '10px', marginBottom: '10px' }}
      />
      <button onClick={startPractice} disabled={isActive}>
        {isActive ? 'Practice in progress...' : 'Start Practice'}
      </button>

      <h2>Settings</h2>
      {Object.entries(settings).map(([operation, { enabled, min, max }]) => (
        <div key={operation} style={{ marginBottom: '10px' }}>
          <input
            type="checkbox"
            id={operation}
            checked={enabled}
            onChange={() => toggleOperation(operation)}
          />
          <label htmlFor={operation} style={{ marginLeft: '5px' }}>
            {operation.charAt(0).toUpperCase() + operation.slice(1)}
          </label>
          <input
            type="number"
            value={min}
            onChange={(e) => setSettings(prev => ({ ...prev, [operation]: { ...prev[operation], min: parseInt(e.target.value) } }))}
            style={{ width: '50px', marginLeft: '10px' }}
          />
          <span style={{ margin: '0 5px' }}>to</span>
          <input
            type="number"
            value={max}
            onChange={(e) => setSettings(prev => ({ ...prev, [operation]: { ...prev[operation], max: parseInt(e.target.value) } }))}
            style={{ width: '50px' }}
          />
        </div>
      ))}

      <h2>History</h2>
      <ul>
        {history.map((entry, index) => (
          <li key={index}>
            {new Date(entry.date).toLocaleString()}: Score {entry.score}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ArithmeticPracticeApp;
