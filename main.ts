import { App, Notice, Plugin, PluginSettingTab, Setting, MarkdownView } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface STTAiEditorSettings {
	googleApiKey: string;
	geminiApiKey: string;
	languageCode: string;
}

const DEFAULT_SETTINGS: STTAiEditorSettings = {
	googleApiKey: '',
	geminiApiKey: '',
	languageCode: 'en-US'
}

export default class STTAiEditorPlugin extends Plugin {
	settings: STTAiEditorSettings;
	isRecording: boolean = false;
	mediaRecorder: MediaRecorder | null = null;
	audioChunks: Blob[] = [];
	genAI: GoogleGenerativeAI | null = null;

	async onload() {
		await this.loadSettings();

		if (this.settings.geminiApiKey) {
			this.genAI = new GoogleGenerativeAI(this.settings.geminiApiKey);
		}

		this.addRibbonIcon('mic', 'STT AI Editor', this.toggleRecording.bind(this));

		this.addSettingTab(new STTAiEditorSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	toggleRecording() {
		if (this.isRecording) {
			this.stopRecording();
		} else {
			this.startRecording();
		}
	}

	async startRecording() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.mediaRecorder = new MediaRecorder(stream);
			this.mediaRecorder.ondataavailable = (event) => {
				this.audioChunks.push(event.data);
			};
			this.mediaRecorder.onstop = this.handleStop.bind(this);
			this.mediaRecorder.start();
			this.isRecording = true;
			new Notice('Recording started...');
		} catch (err) {
			new Notice('Error accessing microphone. Please check permissions.');
			console.error("Error accessing microphone:", err);
		}
	}

	stopRecording() {
		if (this.mediaRecorder && this.isRecording) {
			this.mediaRecorder.stop();
			this.isRecording = false;
			new Notice('Recording stopped.');
		}
	}

	async handleStop() {
		const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
		try {
			const transcript = await this.transcribeAudio(audioBlob);
			const cleanedText = await this.cleanText(transcript);
			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			if (editor) {
				editor.replaceSelection(cleanedText);
			}
		} catch (error) {
			new Notice('Error processing audio. Please check the console for details.');
			console.error(error);
		} finally {
			this.audioChunks = [];
		}
	}

	aasync transcribeAudio(audioBlob: Blob): Promise<string> {
		const reader = new FileReader();
		reader.readAsDataURL(audioBlob);
		return new Promise((resolve, reject) => {
			reader.onloadend = async () => {
				const base64Audio = (reader.result as string).split(',')[1];
				try {
					const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${this.settings.googleApiKey}`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							config: {
								encoding: 'WEBM_OPUS',
								sampleRateHertz: 48000,
								languageCode: this.settings.languageCode,
							},
							audio: {
								content: base64Audio
							}
						})
					});
					const data = await response.json();
					if (data.results && data.results.length > 0) {
						resolve(data.results[0].alternatives[0].transcript);
					} else {
						reject('No transcript found');
					}
				} catch (error) {
					reject(error);
				}
			};
		});
	}

	aasync cleanText(text: string): Promise<string> {
		if (!this.genAI) {
			throw new Error('Generative AI not initialized.');
		}
		const model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
		const prompt = `Please clean up the following text, correcting any grammar or spelling mistakes, and improving the overall readability. Do not add any new information or change the meaning of the text.\n\n${text}`;
		const result = await model.generateContent(prompt);
		const response = await result.response;
		const cleanedText = response.text();
		return cleanedText;
	}
}

class STTAiEditorSettingTab extends PluginSettingTab {
	plugin: STTAiEditorPlugin;

	constructor(app: App, plugin: STTAiEditorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Google API Key')
			.setDesc('Your Google Cloud Speech-to-Text API Key.')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.googleApiKey)
				.onChange(async (value) => {
					this.plugin.settings.googleApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Gemini API Key')
			.setDesc('Your Gemini API Key')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.geminiApiKey)
				.onChange(async (value) => {
					this.plugin.settings.geminiApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Language Code')
			.setDesc('The language code for speech-to-text (e.g., en-US)')
			.addText(text => text
				.setPlaceholder('Enter language code')
				.setValue(this.plugin.settings.languageCode)
				.onChange(async (value) => {
					this.plugin.settings.languageCode = value;
					await this.plugin.saveSettings();
				}));
	}
}
