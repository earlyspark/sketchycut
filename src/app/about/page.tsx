import type { Metadata } from "next";

import { SiteShell } from "../../ui/components/site-shell";

export const metadata: Metadata = {
  title: "About · SketchyCut",
  description: "Why earlyspark built SketchyCut—and how it turns custom ideas into assemblable laser-cut parts."
};

export default function AboutPage() {
  return (
    <SiteShell active="about">
      <main className="about-page">
        <h1>About SketchyCut</h1>
        <div className="about-copy">
          <p>
            Have you ever seen something and thought, “Wow, how did they engineer that?” Or
            wished you could design and make something like it yourself? That&apos;s why I built
            SketchyCut.
          </p>
          <p>
            SketchyCut turns your custom ideas into patterns you can cut out and assemble into a
            3D object. Describe what you want to make and add up to three reference images. For a
            supported construction, SketchyCut creates the laser-cut SVG files, a 3D preview,
            the parts layout, a bill of materials, and assembly instructions.
          </p>
          <p>
            Existing tools can turn an image into a laser-ready 2D file. I wanted to go further:
            reverse engineer the structure behind an idea and turn it into parts that actually
            fit together as a three-dimensional construction.
          </p>
          <h2>How it works</h2>
          <p>
            Describe your idea and optionally add up to three reference images. An OpenAI model
            interprets what you want to build and translates it into structured intent—it does
            not draw the SVG or decide the fabrication geometry.
          </p>
          <p>
            SketchyCut&apos;s deterministic engine maps that intent to supported construction
            capabilities, calculates the exact parts, joints, fits, and motion, then validates
            the result. One canonical design document powers the 3D preview, parts layout, bill
            of materials, assembly instructions, and SVG sheets, so every view describes the
            same project.
          </p>
          <p>
            You can adjust supported dimensions, material thickness, fit, and decorative details
            without another model call. If the core construction is unsupported or validation
            fails, SketchyCut explains the limitation and withholds the fabrication export.
          </p>
          <p>
            I used Codex throughout the project—from research and planning to design and
            execution—to build a hybrid system. An OpenAI model translates your words and images
            into structured semantic intent. A deterministic parametric CAD and fabrication
            engine then owns the math: dimensions, joints, cut paths, assembly, geometry and
            motion validation, and export.
          </p>
          <p>
            The hardest part was making sure SketchyCut didn&apos;t become a collection of fixed
            templates or heuristics that only worked for the examples I had already made. I
            modeled designs as reusable bodies, interfaces, and requirements; built
            general-purpose construction operators that generate geometry from constraints; and
            tested them against deliberately different designs to see whether they generalized.
          </p>
          <p>
            There&apos;s still a lot to explore. I&apos;m continuing to expand SketchyCut&apos;s
            construction vocabulary without giving up generality, deterministic correctness, or
            fabrication reliability.
          </p>
          <p>
            Explore the <a href="https://github.com/earlyspark/sketchycut" target="_blank" rel="noopener noreferrer">project on GitHub</a>.
          </p>
          <div className="about-video">
            <iframe
              src="https://www.youtube-nocookie.com/embed/jsq_vaQXklU"
              title="How I built SketchyCut"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        </div>
      </main>
    </SiteShell>
  );
}
