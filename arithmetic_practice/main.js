let correctAnswer;
let score = 0;
let total = 0;
let timer;
let timerStarted = false;
let soundEnabled = false;
const upcomingQuestions = [];
const cpmHistory = [];

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateQuestion() {
    const operations = [];
    if (document.getElementById('addition').checked) operations.push('+');
    if (document.getElementById('subtraction').checked) operations.push('-');
    if (document.getElementById('multiplication').checked) operations.push('*');
    if (document.getElementById('division').checked) operations.push('/');
    if (document.getElementById('squares').checked) operations.push('^2');
    const operation = operations[Math.floor(Math.random() * operations.length)];

    switch (operation) {
        case '+':
            const addMin1 = parseInt(document.getElementById('addMin1').value) || 2;
            const addMax1 = parseInt(document.getElementById('addMax1').value) || 9;
            const addMin2 = parseInt(document.getElementById('addMin2').value) || 11;
            const addMax2 = parseInt(document.getElementById('addMax2').value) || 99;
            const aAdd = getRandomInt(addMin1, addMax1);
            const bAdd = getRandomInt(addMin2, addMax2);
            return Math.random() < 0.5 ? 
                { question: `${aAdd} + ${bAdd}`, answer: aAdd + bAdd } :
                { question: `${bAdd} + ${aAdd}`, answer: aAdd + bAdd };
        case '-':
            const subMin1 = parseInt(document.getElementById('subMin1').value) || 2;
            const subMax1 = parseInt(document.getElementById('subMax1').value) || 9;
            const subMin2 = parseInt(document.getElementById('subMin2').value) || 11;
            const subMax2 = parseInt(document.getElementById('subMax2').value) || 99;
            const aSub = getRandomInt(subMin1, subMax1);
            const bSub = getRandomInt(subMin2, subMax2);
            return Math.random() < 0.5 ? 
                { question: `${aSub} - ${bSub}`, answer: aSub - bSub } :
                { question: `${bSub} - ${aSub}`, answer: bSub - aSub };
        case '*':
            const mulMin1 = parseInt(document.getElementById('mulMin1').value) || 2;
            const mulMax1 = parseInt(document.getElementById('mulMax1').value) || 9;
            const mulMin2 = parseInt(document.getElementById('mulMin2').value) || 11;
            const mulMax2 = parseInt(document.getElementById('mulMax2').value) || 99;
            const aMul = getRandomInt(mulMin1, mulMax1);
            const bMul = getRandomInt(mulMin2, mulMax2);
            return Math.random() < 0.5 ? 
                { question: `${aMul} * ${bMul}`, answer: aMul * bMul } :
                { question: `${bMul} * ${aMul}`, answer: aMul * bMul };
        case '/':
            const divMin1 = parseInt(document.getElementById('divMin1').value) || 2;
            const divMax1 = parseInt(document.getElementById('divMax1').value) || 9;
            const divMin2 = parseInt(document.getElementById('divMin2').value) || 11;
            const divMax2 = parseInt(document.getElementById('divMax2').value) || 99;
            const aDiv = getRandomInt(divMin1, divMax1);
            const bDiv = getRandomInt(divMin2, divMax2);
            const product = aDiv * bDiv;
            return Math.random() < 0.5 ? 
                { question: `${product} / ${aDiv}`, answer: bDiv } :
                { question: `${product} / ${bDiv}`, answer: aDiv };
        case '^2':
            const squaresMin = parseInt(document.getElementById('squaresMin').value) || 2;
            const squaresMax = parseInt(document.getElementById('squaresMax').value) || 9;
            const aSquare = getRandomInt(squaresMin, squaresMax);
            return { question: `${aSquare}^2`, answer: aSquare * aSquare };
    }
}

function updateUpcomingQuestions() {
    const upcomingQuestionsDiv = document.getElementById('upcoming-questions');
    upcomingQuestionsDiv.innerHTML = '';
    for (let i = 1; i < upcomingQuestions.length; i++) {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'upcoming-question question';
        questionDiv.innerText = upcomingQuestions[i].question;
        upcomingQuestionsDiv.appendChild(questionDiv);
    }
}

function checkAnswer() {
    const answer = parseInt(document.getElementById('answer').value);
    if (answer === correctAnswer) {
        if (soundEnabled) {
            playClickSound();
        }
        score++;
        total++;
        upcomingQuestions.shift();
        const nextQuestion = generateQuestion();
        upcomingQuestions.push(nextQuestion);
        correctAnswer = upcomingQuestions[0].answer;
        document.getElementById('question').innerText = upcomingQuestions[0].question;
        document.getElementById('answer').value = '';
        updateUpcomingQuestions();
        if (!timerStarted) {
            startTimer();
        }
    }
}

function playClickSound() {
    const clickSound = document.getElementById('click-sound');
    clickSound.currentTime = 0;
    clickSound.play();
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    document.getElementById('toggleSound').value = soundEnabled ? 'Sound: On' : 'Sound: Off';
}

function startTimer() {
    timerStarted = true;
    score = 0;
    total = 0;
    const timeLimit = parseInt(document.getElementById('timeSelect').value);
    document.getElementById('cpm-display').innerText = `CPM: 0`;
    document.getElementById('question-area').classList.add('started');

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '100%';

    const interval = timeLimit * 1000; // Total time in milliseconds
    const decrement = 100 / timeLimit; // Percentage decrement per second

    timer = setInterval(() => {
        const currentTime = parseInt(document.querySelector('#progress-bar').style.width.replace('%', ''));
        if (currentTime > 0) {
            progressBar.style.width = `${currentTime - decrement}%`;
            let cpm = Math.floor((score / (timeLimit - (currentTime / decrement))) * 60);
            if (isNaN(cpm) || !isFinite(cpm)) {
                cpm = 0;
            }
            document.getElementById('cpm-display').innerText = `CPM: ${cpm}`;
        } else {
            clearInterval(timer);
            let cpm = Math.floor((score / timeLimit) * 60);
            if (isNaN(cpm) || !isFinite(cpm)) {
                cpm = 0;
            }
            cpmHistory.push(cpm);
            updateCpmHistory();
            setTimeout(() => {
                initializePractice();
            }, 500); // Pause for 0.5 seconds before restarting
        }
    }, 1000);
}

function updateCpmHistory() {
    const cpmHistoryDiv = document.getElementById('cpm-history');
    cpmHistoryDiv.innerHTML = '';
    cpmHistory.forEach(cpm => {
        const cpmItem = document.createElement('div');
        cpmItem.className = 'history-row';
        cpmItem.innerText = cpm;
        cpmHistoryDiv.appendChild(cpmItem);
    });
}

function restartOnEnter(event) {
    if (event.key === "Enter") {
        initializePractice();
        document.getElementById('answer').focus();
    }
}

function initializePractice() {
    clearInterval(timer);
    timerStarted = false;
    document.getElementById('question-area').classList.remove('started');
    document.getElementById('answer').value = '';
    document.getElementById('cpm-display').innerText = `CPM: 0`;
    upcomingQuestions.length = 0;
    document.getElementById('progress-bar').style.width = '100%';
    for (let i = 0; i < 4; i++) {
        const nextQuestion = generateQuestion();
        upcomingQuestions.push(nextQuestion);
    }
    correctAnswer = upcomingQuestions[0].answer;
    document.getElementById('question').innerText = upcomingQuestions[0].question;
    updateUpcomingQuestions();
    document.getElementById('answer').focus();
}

document.addEventListener('DOMContentLoaded', (event) => {
    initializePractice();
    document.getElementById('answer').focus();
});
