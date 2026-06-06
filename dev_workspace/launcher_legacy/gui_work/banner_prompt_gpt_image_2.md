# LEON Launcher Header Banner Prompt

Target output:

- Temporary generated file: `D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\gui_work\leon-launcher-banner-gpt-image-2.png`
- Final launcher asset after approval/crop: `D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\leon-launcher-banner-avatar-ai.png`
- Prompt-only file: `D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\gui_work\banner_prompt_gpt_image_2.txt`
- Model: `gpt-image-2`
- Size: `2048x1152`
- Quality: `high`

Prompt:

```text
Use case: stylized-concept
Asset type: Windows launcher header banner for a local desktop AI voice service
Primary request: Create a wide landscape banner for LEON / IndexTTS2 vLLM, a practical local voice synthesis launcher.
Scene/backdrop: A dark but not black local voice studio interface, with subtle audio waveform lines, GPU compute lattice details, and restrained technical depth.
Subject: Abstract voice synthesis and local GPU inference, no people and no face.
Style/medium: polished cinematic desktop-tool banner, realistic-stylized, refined and practical rather than marketing-like.
Composition/framing: 2048x1152 landscape. Keep safe negative space on the left for launcher title and status text. Put visual interest in the center-right and right side. The image must still read well when cropped into a shallow top header.
Lighting/mood: low-key studio lighting with crisp edges, calm professional mood.
Color palette: deep neutral charcoal base, subtle cyan/teal signal lines, small warm amber accents, avoid a one-note blue or purple palette.
Materials/textures: glassy waveform traces, soft GPU-grid glow, clean matte desktop-tool surfaces.
Text: no text.
Constraints: no readable words, no logos, no watermark, no people, no faces, no mascot, no clutter, no dramatic fantasy scene. Must feel like a practical Windows launcher header, not a web landing-page hero.
Avoid: stock-photo look, large decorative gradient blobs, blurry dark empty background, neon cyberpunk overload, readable UI text.
```

Command after `OPENAI_API_KEY` is set:

```powershell
python "C:\Users\Administrator\.codex\skills\imagegen\scripts\image_gen.py" generate --model gpt-image-2 --quality high --size 2048x1152 --no-augment --prompt-file "D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\gui_work\banner_prompt_gpt_image_2.txt" --out "D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\gui_work\leon-launcher-banner-gpt-image-2.png" --force
```

Notes:

- Do not run this command without `OPENAI_API_KEY`.
- Keep generated intermediates in this `gui_work` directory, not on `C:\`.
- After generation, inspect the banner in the launcher screenshot before replacing the final asset.
