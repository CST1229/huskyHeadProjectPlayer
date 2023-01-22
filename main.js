import "./style.css";
import "@turbowarp/packager/dist/scaffolding/scaffolding-full.js";
import RgbQuant from "rgbquant";

const container = document.body.appendChild(document.createElement("div"));
container.className = "container";

const scaffolding = new Scaffolding.Scaffolding();
window.scaffolding = scaffolding;

{
	// Load file controls
	const controls = container.appendChild(document.createElement("div"));
	controls.className = "controls";
	
	const idInput = controls.appendChild(document.createElement("input"));
	idInput.type = "number";
	idInput.className = "grow";
	idInput.placeholder = "Project ID...";
	idInput.addEventListener("change", () => {
		loadScratch(idInput.value);
	});
	
	const fileEl = controls.appendChild(document.createElement("input"));
	fileEl.className = "file";
	fileEl.type = "file";
	fileEl.addEventListener("change", () => {
		if (!fileEl.files[0]) return;
		idInput.value = "";
		importProject(fileEl.files[0]);
		fileEl.value = null;
	});
	const load = controls.appendChild(document.createElement("button"));
	load.textContent = "Load File";
	load.addEventListener("click", () => fileEl.click());
}

const projectEl = document.createElement("div");
projectEl.className = "project dark plsload";

{
	// Project controls
	const controls = container.appendChild(document.createElement("div"));
	controls.className = "controls";
	
	const start = controls.appendChild(document.createElement("button"));
	start.textContent = "Start";
	start.onclick = () => {
		if (
			projectEl.classList.contains("plsload") ||
			projectEl.classList.contains("loading") ||
			projectEl.classList.contains("loaderror")
		) return;
		projectEl.classList.remove("dark", "pressstart");
		scaffolding.start();
	};
	const stop = controls.appendChild(document.createElement("button"));
	stop.textContent = "Stop";
	stop.onclick = () => scaffolding.stopAll();
}

container.appendChild(projectEl);

scaffolding.setup();

const storage = scaffolding.storage;
storage.addWebStore(
	[storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound],
	(asset) => `https://assets.scratch.mit.edu/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`
);

async function importProject(file) {
	projectEl.classList.remove("plsload", "pressstart", "loading", "loaderror");
	projectEl.classList.add("loading", "dark");
	try {
		if (scaffolding.vm) scaffolding.vm.stop();
		const bfr = file instanceof ArrayBuffer ? file : (await file.arrayBuffer());
		await scaffolding.loadProject(bfr);
	} catch(e) {
		console.log(e);
		projectEl.classList.remove("loading");
		projectEl.classList.add("loaderror");
		return;
	}
	projectEl.classList.remove("loading");
	projectEl.classList.add("dark", "pressstart");
}

async function loadScratch(id) {
	if (!parseInt(id.toString())) return;
	
	projectEl.classList.remove("plsload", "pressstart", "loading", "loaderror");
	projectEl.classList.add("loading", "dark");
	
	const projectMetadata = await (await fetch(`https://trampoline.turbowarp.org/proxy/projects/${id}`)).json();
	const token = projectMetadata.project_token;
	const projectData = await (await fetch(`https://projects.scratch.mit.edu/${id}?token=${token}`)).arrayBuffer();
	importProject(projectData);
}

scaffolding.appendTo(projectEl);

{
	// CANVAS QUANTIZATION //
	// makes the canvas low quality
	
	// the vanilla canvas uses up the webgl context,
	// but we want the 2d context so we can display the quantified image
	const qCan = document.createElement("canvas");
	qCan.className = "not-sc-canvas";
	const qCtx = qCan.getContext("2d");
	{
		const canvas = scaffolding.renderer.canvas;
		
		canvas.parentElement.insertBefore(qCan, canvas);
	}
	
	function getSRImageData(rend) {
		const can = rend.canvas;
		const gl = rend.gl;
		
		const pixels = new Uint8Array(can.width * can.height * 4);
		const out = gl.readPixels(
			0, 0, can.width, can.height ,
			gl.RGBA, gl.UNSIGNED_BYTE, pixels
		);
		return new ImageData(Uint8ClampedArray.from(pixels), can.width, can.height);
	}
	
	const ogDraw = Scaffolding.Renderer.prototype.draw;
	Scaffolding.Renderer.prototype.draw = function(...args) {
		const returnValue = ogDraw.apply(this, args);
		
		const can = this.canvas;
		const imgData = getSRImageData(this);
		
		const q = new RgbQuant({
			colors: 16,
			dithKern: "FloydSteinberg",
		});
		q.sample(imgData);
		const out = q.reduce(imgData);
		
		qCan.width = can.width;
		qCan.height = can.height;
		qCtx.putImageData(
			new ImageData(Uint8ClampedArray.from(out), can.width, can.height),
			0, 0
		);
		return returnValue;
	};
}

{
	// SOUND DEGRADATION //
	// makes the sound low quality
	
	const SAMPLE_RESOLUTION = 15;
	const SAMPLE_DIVIDER = 2;
	
	const ogDecodeSound = Scaffolding.AudioEngine.prototype._decodeSound;
	// quite a hacky way to do it - modify the sound after it's decoded
	Scaffolding.AudioEngine.prototype._decodeSound = async function(...args) {
		const returnValue = await ogDecodeSound.apply(this, args);
		
		
		const bfr = returnValue[1];
		// thanks mdn
		for (let channel = 0; channel < bfr.numberOfChannels; channel++) {
			const nowBuffering = bfr.getChannelData(channel);
			let sample = 0;
			for (let i = 0; i < bfr.length; i++) {
				// lower the sample rate
				if (i % SAMPLE_DIVIDER === 0) {
					// additionally, lower the samples' resolution
					sample = Math.round(nowBuffering[i] * SAMPLE_RESOLUTION) / SAMPLE_RESOLUTION;
				}
				nowBuffering[i] = sample;
			}
		}
		
		return returnValue;
	};
}