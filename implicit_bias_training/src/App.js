import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './components/ui/button';  // Updated import path

const ImageClassificationGame = () => {
  const [targetImage, setTargetImage] = useState(null);
  const [responseImages, setResponseImages] = useState([]);
  const [score, setScore] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);

  const sampleImage = useCallback((folder) => {
    // This is a placeholder. In a real app, you'd fetch images from your server
    return `/${folder}/${Math.random()}.jpg`;
  }, []);

  const setupNewRound = useCallback(() => {
    const isTargetGood = Math.random() < 0.5;
    const newTargetImage = sampleImage(isTargetGood ? 'target_good' : 'target_bad');
    const newResponseImages = [
      { src: sampleImage('good'), isGood: true },
      { src: sampleImage('bad'), isGood: false },
    ].sort(() => Math.random() - 0.5);

    setTargetImage({ src: newTargetImage, isGood: isTargetGood });
    setResponseImages(newResponseImages);
  }, [sampleImage]);

  useEffect(() => {
    setupNewRound();
  }, [setupNewRound]);

  const handleSelection = useCallback((index) => {
    if (responseImages[index].isGood === targetImage.isGood) {
      setScore(prevScore => prevScore + 1);
    }
    setTotalAttempts(prevAttempts => prevAttempts + 1);
    setupNewRound();
  }, [responseImages, targetImage, setupNewRound]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'f') handleSelection(0);
      if (e.key === 'j') handleSelection(1);
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleSelection]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <h1 className="text-2xl font-bold mb-4">Image Classification Game</h1>
      <div className="mb-4">
        <img src={targetImage?.src} alt="Target" className="w-64 h-64 object-cover rounded-lg shadow-md" />
      </div>
      <div className="flex space-x-4">
        {responseImages.map((img, index) => (
          <div key={index} className="text-center">
            <img src={img.src} alt={`Response ${index + 1}`} className="w-48 h-48 object-cover mb-2 rounded-lg shadow-md" />
            <Button 
              onClick={() => handleSelection(index)}
              className="w-full"
            >
              Select ({index === 0 ? 'F' : 'J'})
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-4 text-lg font-semibold">
        <p>Score: {score}</p>
        <p>Total Attempts: {totalAttempts}</p>
        <p>Accuracy: {totalAttempts > 0 ? ((score / totalAttempts) * 100).toFixed(2) : 0}%</p>
      </div>
    </div>
  );
};

export default ImageClassificationGame;
