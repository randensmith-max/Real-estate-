Property Marketing Generator

Production Technical Plan

Version: 1.0
Status: Pre-development specification
Primary Objective: Convert a Rightmove property listing into professional automated marketing assets.

⸻

1. PRODUCT VISION

Build a production-quality Property Marketing Generator capable of accepting a Rightmove property listing URL and automatically producing:

1. A cinematic vertical social-media property reel
2. An animated digital property brochure
3. Reusable structured property data
4. Downloadable marketing assets
5. A reviewable generation job with individual intermediate outputs

The system should transform a raw property listing into polished marketing content with minimal manual intervention while maintaining strong factual accuracy and visual consistency.

The system must not simply scrape photographs and place them into a slideshow.

It should:

* understand the property
* identify its strongest selling points
* analyze listing photographs
* select and rank photographs intelligently
* generate cinematic motion from selected photographs
* produce property-specific marketing copy
* build a coherent visual narrative
* create branded animated layouts
* assemble music, transitions, typography, imagery, and generated footage
* produce deterministic final outputs
* allow failed stages to be retried independently

⸻

2. PRIMARY USER FLOW

The intended workflow is:

Rightmove URL
      ↓
Listing Acquisition
      ↓
Structured Property Data
      ↓
Image Acquisition
      ↓
Claude Vision Analysis
      ↓
Property Marketing Brief
      ↓
Shot Selection + Storyboard
      ↓
Higgsfield Image-to-Video
      ↓
HyperFrames Motion Graphics
      ↓
Brochure Generation
      ↓
FFmpeg Media Assembly
      ↓
Quality Validation
      ↓
Final Deliverables

User experience:

Paste Rightmove URL
        ↓
Click Generate
        ↓
Property imported
        ↓
AI analyses property
        ↓
Storyboard generated
        ↓
Video scenes generated
        ↓
Marketing reel assembled
        ↓
Digital brochure rendered
        ↓
User previews outputs
        ↓
User downloads / regenerates

⸻

3. CORE ARCHITECTURAL PRINCIPLE

The application must use a pipeline architecture.

Each major operation is an independent stage.

No single service should contain the entire generation process.

Each external provider must be wrapped behind an internal interface.

Example:

VideoGenerationProvider
    └── HiggsfieldProvider
VisionProvider
    └── ClaudeVisionProvider
BrowserProvider
    └── PlaywrightProvider
MotionGraphicsRenderer
    └── HyperFramesRenderer
MediaProcessor
    └── FFmpegProcessor

This allows providers to be replaced in the future without rewriting the orchestration layer.

For example:

Higgsfield
    ↓
could later become
Kling
Veo
Runway
Sora
Wan

without changing the rest of the application.

⸻

4. RECOMMENDED TECHNOLOGY STACK

Application Language

Use:

TypeScript

The primary codebase should use strict TypeScript.

Reasons:

* strong API contracts
* excellent Playwright integration
* strong Node.js media ecosystem
* HyperFrames is Node-oriented
* easier sharing of types between backend and frontend
* fewer runtime data-contract errors

Enable:

strict: true
noImplicitAny: true
strictNullChecks: true

⸻

5. RECOMMENDED APPLICATION STACK

Frontend

Use:

Next.js

Responsibilities:

* URL submission
* project management
* property preview
* generation status
* asset preview
* regeneration controls
* settings
* download interface

Use server/client separation correctly.

Do not place API credentials in browser code.

⸻

Backend

Use a dedicated application/service layer.

Recommended structure:

Next.js
+
Background Job Workers
+
Database
+
Object Storage

Heavy media generation must NOT run directly inside normal web requests.

Video generation can take minutes.

The request should create a job and immediately return a job ID.

⸻

6. REPOSITORY STRUCTURE

Recommended monorepo:

property-marketing-generator/
apps/
  web/
  worker/
packages/
  core/
  database/
  listing/
  vision/
  video-generation/
  hyperframes/
  ffmpeg/
  brochure/
  storage/
  shared/
  config/
  observability/
templates/
  reels/
  brochures/
assets/
  fonts/
  music/
  graphics/
scripts/
tests/
  integration/
  e2e/
  fixtures/
docker/
docs/
Technical Plan.md
README.md
.env.example
package.json
tsconfig.json

⸻

7. DOMAIN MODEL

The system should revolve around a PropertyProject.

Conceptual structure:

PropertyProject
id
status
sourceUrl
createdAt
updatedAt
property
images
analysis
marketingBrief
storyboard
videoScenes
brochure
outputs
generationSettings
errors

⸻

8. PROPERTY DATA MODEL

Structured property information should include:

Property
address
postcode
price
currency
propertyType
bedrooms
bathrooms
receptions
tenure
size
sizeUnit
description
keyFeatures[]
agentName
agentPhone
agentLogo
branchName
listingUrl
floorplanUrls[]
imageUrls[]
latitude
longitude

Fields must be nullable where the source listing does not provide them.

Never invent missing property facts.

⸻

9. LISTING INGESTION SYSTEM

Objective

Convert a Rightmove URL into structured property information and downloadable media.

Example input:

https://www.rightmove.co.uk/properties/...

⸻

10. RIGHTMOVE ACQUISITION STRATEGY

Rightmove must be treated as an external website rather than a guaranteed API.

The acquisition system should therefore be isolated behind:

ListingProvider

Implementation:

RightmoveListingProvider

Do NOT allow Rightmove-specific DOM selectors throughout the application.

All Rightmove extraction logic belongs inside the provider.

⸻

11. PLAYWRIGHT LISTING EXTRACTION

Playwright should load the property page using Chromium.

Pipeline:

URL validation
↓
Navigate
↓
Wait for meaningful content
↓
Extract structured page data
↓
Extract visible property facts
↓
Extract image URLs
↓
Extract floorplan URLs
↓
Capture diagnostic screenshot
↓
Normalize
↓
Validate

Preference order:

1. Structured JSON present in the page
2. Semantic/accessible page data
3. Stable attributes
4. DOM selectors as fallback

Avoid fragile selectors based purely on generated CSS class names.

⸻

12. RIGHTMOVE RISK

Rightmove extraction is one of the largest operational risks.

Potential problems:

* HTML changes
* anti-bot systems
* rate limits
* cookie prompts
* CAPTCHA
* listing removal
* regional differences
* lazy-loaded images
* image CDN restrictions
* site terms restricting automated extraction

The application must therefore support future listing providers.

Examples:

Rightmove
Zoopla
OnTheMarket
MLS feeds
Manual property entry
JSON import
Agent CRM feeds

Do not couple the product permanently to Rightmove.

⸻

13. LISTING SNAPSHOT

Every imported listing should create a normalized immutable snapshot.

Example:

listing-snapshot.json

This prevents later changes on Rightmove from unexpectedly changing an existing project.

Record:

sourceUrl
importTimestamp
sourceData
normalizedData

⸻

14. IMAGE ACQUISITION

Original listing images should be downloaded into controlled storage.

Never rely on external Rightmove image URLs during later rendering.

Pipeline:

Image URL
↓
Download
↓
Validate MIME type
↓
Validate dimensions
↓
Calculate hash
↓
Remove duplicates
↓
Normalize metadata
↓
Store original
↓
Generate working derivative

Suggested working format:

JPEG/WebP
high quality
max dimension ~2500–3000 px

Preserve original files separately.

⸻

15. IMAGE SECURITY

Remote media downloading creates SSRF risk.

The downloader must protect against:

* localhost URLs
* private IP ranges
* metadata endpoints
* unexpected redirects
* non-image payloads
* enormous files
* decompression bombs

Apply:

domain validation
redirect validation
MIME checking
size limits
timeouts

⸻

16. CLAUDE VISION ANALYSIS

Claude Vision should analyze property imagery and listing information.

The model should NOT simply receive all images and generate generic copy.

Use a structured multi-stage analysis.

⸻

17. IMAGE-LEVEL ANALYSIS

Each image should receive metadata such as:

imageId
roomType
roomConfidence
visualQualityScore
marketingValueScore
brightness
compositionQuality
clutterLevel
orientation
estimatedShotType
features[]
possibleIssues[]
recommendedUse
motionRecommendation

Possible room types:

exterior
entrance
living room
kitchen
dining room
bedroom
bathroom
garden
patio
balcony
garage
office
utility
hallway
view
floorplan
other

⸻

18. IMPORTANT VISION RULE

Claude must clearly distinguish:

OBSERVED FACT
LISTING-PROVIDED FACT
INFERENCE
MARKETING INTERPRETATION

For example:

Bad:

Recently renovated kitchen

unless the listing explicitly confirms renovation.

Acceptable:

Contemporary-looking kitchen with light cabinetry

The AI must not invent:

* renovations
* materials
* appliance brands
* exact room sizes
* views
* neighborhood characteristics
* schools
* commute times
* investment returns

unless supplied by verified data.

⸻

19. PROPERTY-LEVEL ANALYSIS

After individual photographs are analyzed, Claude receives:

normalized listing
+
image analyses

It produces a:

PropertyMarketingBrief

Example:

targetAudience
positioning
topSellingPoints[]
visualThemes[]
heroImageId
secondaryImageIds[]
reelNarrative
brochureNarrative
tone
recommendedMusicStyle
recommendedMotionStyle
copyRestrictions[]

⸻

20. STRUCTURED MODEL OUTPUT

All Claude responses used by the application must conform to schemas.

Use JSON schema validation.

Recommended:

Zod

Never parse free-form AI text into production logic when structured output can be used.

Invalid output should trigger:

validation
↓
repair attempt
↓
retry
↓
failure state

⸻

21. IMAGE RANKING

Each photo should receive a composite score.

Example weighting:

technical quality
marketing value
uniqueness
property importance
cinematic potential
composition quality

The system should prevent repetitive selection.

Example:

A listing containing eight bedroom photographs should not automatically produce a reel containing five bedroom shots.

Introduce room diversity constraints.

⸻

22. REEL STORYBOARD ENGINE

The storyboard engine converts the property marketing brief into a cinematic sequence.

Target initial reel:

9:16
1080 × 1920
30 FPS
20–35 seconds

Optional future formats:

4:5
1:1
16:9

⸻

23. REEL STRUCTURE

Recommended structure:

Scene 1 — Hook

Strong exterior or best interior.

Example duration:

2–3 seconds

Possible overlay:

4 BEDROOM DETACHED HOME

⸻

Scene 2 — Value

Display:

location
price
major property characteristic

⸻

Scenes 3–7 — Property Journey

Example:

Exterior
↓
Living area
↓
Kitchen
↓
Primary bedroom
↓
Bathroom
↓
Outdoor space

Sequence should vary depending on property.

⸻

Final Scene — CTA

Example:

Book a viewing

or configurable agency CTA.

⸻

24. STORYBOARD MODEL

Each scene should contain:

sceneId
order
sourceImageId
duration
sceneType
videoPrompt
negativePrompt
cameraMotion
motionIntensity
textOverlay
textPosition
transitionIn
transitionOut
musicCue
generatedVideoAssetId

⸻

25. HIGGSFIELD INTEGRATION

Higgsfield should be isolated behind:

VideoGenerationProvider

Example conceptual operation:

generateImageToVideo()

Input:

source image
prompt
aspect ratio
duration
motion configuration

Output:

providerJobId
status
videoUrl
metadata

⸻

26. HIGGSFIELD API RISK

Do not assume a specific unofficial endpoint.

Before implementation, verify:

official API availability
authentication method
supported models
image-to-video support
maximum duration
supported resolutions
rate limits
credit cost
job polling
webhook support
commercial-use rights
download URL expiration

If direct API access is unavailable for the account, development must stop at this integration boundary and an approved alternative must be chosen.

Do NOT automate Higgsfield's consumer web interface as a hidden replacement without explicit approval.

⸻

27. VIDEO GENERATION PROMPTING

Prompts should emphasize realistic camera movement rather than changing the property itself.

Example conceptual prompt:

Slow cinematic dolly forward through the room.
Preserve the exact architecture, furniture,
windows, lighting, dimensions, and layout.
Natural luxury real-estate cinematography.
No new objects. No structural changes.
No people.

Motion options:

slow push-in
slow pull-back
pan left
pan right
dolly
orbit
tilt
crane
subtle parallax

⸻

28. PROPERTY PRESERVATION

This is critical.

Generative video models can hallucinate.

Common failures:

* changing furniture
* moving walls
* adding doors
* changing windows
* creating nonexistent rooms
* altering landscaping
* changing property dimensions

Generated clips must therefore be treated as marketing enhancement rather than verified documentation.

Introduce automatic and manual QA.

Rejected generations can be regenerated.

⸻

29. GENERATION VARIANTS

Initially generate one preferred clip per selected image.

Architecture should support:

scene
 ├── variant A
 ├── variant B
 └── variant C

so future versions can allow users to choose the best animation.

⸻

30. HYPERFRAMES ROLE

HyperFrames should handle deterministic motion graphics and layout composition.

Use it for:

* animated typography
* property information
* price cards
* feature callouts
* masks
* gradients
* transitions
* logo animation
* location titles
* CTA sequence
* captions
* graphic framing
* deterministic composition

Do not use generative AI for elements that should remain perfectly accurate.

⸻

31. HYPERFRAMES TEMPLATE SYSTEM

Create reusable reel templates.

Example:

templates/reels/
  cinematic-luxury/
  modern-clean/
  bold-agent/
  minimal-premium/

Template inputs should be data-driven.

Example:

property
brand
storyboard
media
theme

Do not hard-code individual property information inside templates.

⸻

32. BRAND CONFIGURATION

Create reusable:

BrandProfile

Fields:

agencyName
agencyLogo
primaryColor
secondaryColor
accentColor
fontHeading
fontBody
agentName
agentPhone
agentEmail
website
ctaText
watermarkEnabled

This allows white-label use.

⸻

33. FFMPEG ROLE

FFmpeg is the final deterministic media-processing layer.

Responsibilities:

transcoding
resolution normalization
frame-rate normalization
audio normalization
clip trimming
clip concatenation
music mixing
fade processing
format conversion
thumbnail extraction
metadata inspection
final encoding

⸻

34. VIDEO NORMALIZATION

Every externally generated clip should be normalized before composition.

Example target:

1080x1920
30fps
H.264
yuv420p
constant compatible timebase
AAC audio where required

This prevents concat/render problems caused by providers returning different codecs or frame rates.

⸻

35. AUDIO SYSTEM

Initial audio sources:

licensed music library
user-uploaded audio
approved royalty-free assets

Future:

AI-generated music
AI voice-over
automatic beat synchronization

Music rights must be stored with the asset metadata.

Never ship unlicensed copyrighted music as a production default.

⸻

36. AUDIO PROCESSING

FFmpeg should support:

music trim
fade in
fade out
loudness normalization
ducking
voice-over mixing

Maintain a target loudness standard for consistent exports.

⸻

37. DIGITAL BROCHURE

The brochure should NOT simply be a PDF version of Rightmove.

It should be a branded standalone presentation.

Outputs should include:

interactive HTML brochure
+
printable PDF brochure

Optional future output:

animated brochure video

⸻

38. BROCHURE CONTENT

Recommended structure:

Cover
Property overview
Key features
Hero imagery
Living spaces
Kitchen
Bedrooms
Bathrooms
Outdoor areas
Floorplan
Property description
Agent details
CTA

Sections should appear only when the required information exists.

⸻

39. BROCHURE IMPLEMENTATION

Build brochure templates using HTML/CSS.

Use:

React components
+
server-rendered HTML

Then use Playwright to:

load brochure
wait for fonts/assets
verify layout
capture screenshots
export PDF

⸻

40. ANIMATED DIGITAL BROCHURE

The web brochure may include:

scroll animations
image reveals
parallax
animated statistics
feature transitions
image galleries
video clips
CTA interactions

Animations should degrade gracefully.

The PDF version must remain visually correct without animation.

⸻

41. FLOORPLANS

Floorplans require separate treatment from photos.

They should not be sent through generative-video transformation by default.

Use them accurately.

Possible presentation:

clean framed layout
zoom/pan animation
floor selector
highlight effect

Never modify architectural floorplan information.

⸻

42. GENERATION ORCHESTRATOR

Create:

GenerationPipeline

It controls the workflow but does NOT implement provider-specific behavior.

Conceptual stages:

IMPORT_LISTING
DOWNLOAD_MEDIA
ANALYZE_IMAGES
CREATE_MARKETING_BRIEF
CREATE_STORYBOARD
GENERATE_VIDEO_SCENES
BUILD_REEL
BUILD_BROCHURE
VALIDATE_OUTPUTS
COMPLETE

⸻

43. STATE MACHINE

Use explicit job states.

Do not use scattered boolean flags such as:

isAnalyzed
isRendered
isDone

Use defined states.

Example:

PENDING
RUNNING
SUCCEEDED
FAILED
RETRYING
CANCELLED

Each pipeline stage should track status independently.

⸻

44. JOB QUEUE

Long-running tasks require a queue.

Recommended options:

BullMQ + Redis

or another approved durable job system.

Queues may include:

listing-import
vision-analysis
video-generation
motion-render
brochure-render
media-processing

⸻

45. IDEMPOTENCY

Jobs must be restartable.

If rendering fails after Higgsfield has already created five clips, retrying should NOT regenerate all five clips unnecessarily.

Each stage should store:

input hash
output asset
provider job ID
status

Before performing work:

calculate inputs
↓
check existing successful output
↓
reuse if unchanged

⸻

46. DATABASE

Recommended:

PostgreSQL

Possible ORM:

Prisma

or another strongly typed database layer.

Core tables:

users
projects
properties
listing_snapshots
property_images
image_analyses
marketing_briefs
storyboards
storyboard_scenes
generation_jobs
provider_jobs
assets
brand_profiles
brochures
reels
generation_events

⸻

47. ASSET STORAGE

Generated media must not live permanently on the web server's local disk.

Use S3-compatible object storage.

Examples:

AWS S3
Cloudflare R2
Backblaze B2

Asset metadata belongs in PostgreSQL.

Binary files belong in object storage.

⸻

48. ASSET STRUCTURE

Example:

projects/{projectId}/
source/
  listing.json
  images/
  floorplans/
analysis/
  image-analysis.json
  marketing-brief.json
  storyboard.json
generated/
  scenes/
renders/
  reel.mp4
  reel-thumbnail.jpg
  brochure.pdf
  brochure-preview.jpg

⸻

49. FILE HASHING

Calculate SHA-256 hashes for assets.

Use them for:

deduplication
cache validation
idempotency
integrity

⸻

50. API DESIGN

Recommended API categories:

POST /projects
GET /projects/:id
POST /projects/:id/import
POST /projects/:id/analyze
POST /projects/:id/storyboard
POST /projects/:id/generate-reel
POST /projects/:id/generate-brochure
GET /projects/:id/jobs
POST /scenes/:id/regenerate
GET /assets/:id

Exact routing may use Next.js route handlers or a dedicated API service.

⸻

51. AUTHENTICATION

Initial production application should include authentication.

Possible:

Auth.js
Clerk
Supabase Auth

All database records must be scoped by account/user.

Never trust project IDs supplied by clients without authorization checks.

⸻

52. ENVIRONMENT VARIABLES

Expected categories:

DATABASE_URL
REDIS_URL
ANTHROPIC_API_KEY
HIGGSFIELD_API_KEY
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
APPLICATION_URL
AUTH_SECRET
FFMPEG_PATH
NODE_ENV
LOG_LEVEL

Do not commit .env.

Create:

.env.example

with empty placeholders.

⸻

53. SECRET MANAGEMENT

Production secrets should eventually live in the deployment platform's secret manager.

Never:

log API keys
return API keys to frontend
embed keys in browser JavaScript
store keys in generated project files

⸻

54. OBSERVABILITY

Every generation should have a correlation ID.

Log:

projectId
jobId
stage
provider
providerJobId
duration
status
retryCount
errorCode

Use structured logs.

Avoid logging entire AI payloads where those payloads may contain sensitive data.

⸻

55. ERROR MODEL

Create typed application errors.

Examples:

ListingUnavailableError
ListingParseError
MediaDownloadError
VisionAnalysisError
ProviderRateLimitError
ProviderGenerationError
RenderError
AssetStorageError
ValidationError

Do not return raw internal stack traces to users.

⸻

56. RETRY POLICY

Retry only errors likely to be transient.

Examples:

Retry:

HTTP 429
HTTP 502
HTTP 503
timeouts
temporary provider failures

Do not repeatedly retry:

invalid URL
unsupported file
schema violation after repair attempts
authentication failure
insufficient provider credits

Use exponential backoff with jitter.

⸻

57. PROVIDER RATE LIMITING

External AI providers may have rate limits.

Create provider-specific concurrency controls.

Example:

Claude concurrency
Higgsfield concurrency
render concurrency

Do not launch 20 video generations simultaneously merely because the listing contains 20 images.

⸻

58. COST CONTROL

Every project should track estimated and actual generation cost.

Possible fields:

visionInputTokens
visionOutputTokens
videoGenerationCount
videoGenerationCost
storageCostEstimate
renderDuration
totalEstimatedCost

Eventually expose a maximum allowed generation budget.

This prevents runaway costs.

⸻

59. GENERATION MODES

Recommended modes:

Draft

Lower cost.

fewer selected scenes
lower-cost model
short preview

Production

full quality
all final renders
final brochure

Do not force expensive final video generation while users are still testing layouts.

⸻

60. QUALITY ASSURANCE

Automated QA should occur before marking the project complete.

Validate:

output exists
duration valid
resolution valid
codec valid
audio stream valid
file size valid
all expected scenes included
brochure renders
required property facts present

Use FFprobe for media validation.

⸻

61. VISUAL QA

Use Playwright screenshot tests for:

brochure layouts
dashboard
templates
reel graphic compositions

Maintain deterministic rendering environment in CI.

⸻

62. AI QA

Before publishing text, run factual consistency checks.

Compare generated marketing copy against:

normalized listing
verified image observations

Flag unsupported claims.

Example:

If copy says:

south-facing garden

but the listing never states this, it should fail verification.

⸻

63. MANUAL REVIEW

Version 1 should include a review screen before final export.

User should be able to inspect:

property facts
selected images
marketing copy
storyboard
generated clips
brochure

Allow:

replace image
edit copy
regenerate clip
change ordering
disable scene
change CTA

Automation should accelerate human judgment rather than remove all control.

⸻

64. ADMINISTRATIVE UI

Main screens:

Login
Dashboard
New Project
Project Import
Property Review
AI Analysis
Storyboard
Scene Generation
Reel Preview
Brochure Preview
Export
Brand Settings

⸻

65. PROJECT DASHBOARD

Show:

property address
property photo
status
creation date
reel status
brochure status
errors

⸻

66. PROJECT GENERATION PAGE

Display pipeline visually:

✓ Property imported
✓ 22 photographs downloaded
✓ AI analysis complete
✓ Storyboard generated
◉ Generating cinematic scenes 4/7
○ Reel assembly
○ Brochure

Users should understand what the system is doing.

⸻

67. TESTING STRATEGY

Testing should occur at four levels.

Unit Tests

Test:

schema validation
property normalization
image ranking
storyboard rules
prompt construction
FFmpeg argument generation
file hashing
cost calculations

⸻

Integration Tests

Mock external APIs.

Test:

Claude integration
Higgsfield integration
storage
database
Redis
Playwright extraction
FFmpeg processing
HyperFrames rendering

⸻

Contract Tests

Store provider response fixtures.

Ensure provider adapters detect API changes.

⸻

End-to-End Tests

Use a controlled property fixture.

Pipeline:

fixture listing
↓
analysis fixture
↓
mock video generation
↓
reel render
↓
brochure render
↓
validation

Do not make normal CI tests spend real AI credits.

⸻

68. RIGHTMOVE TEST FIXTURES

Do not depend entirely on live Rightmove pages in CI.

Maintain captured legal test fixtures where permitted.

This prevents external page changes from breaking every test.

A separate scheduled integration test may validate current live compatibility.

⸻

69. DEVELOPMENT ENVIRONMENT

Recommended minimum:

Node.js 22+
PostgreSQL
Redis
FFmpeg
Chromium / Playwright browser dependencies
Docker

HyperFrames requirements should be pinned to compatible versions.

⸻

70. DOCKER

Create Docker services for:

web
worker
postgres
redis

Rendering worker images need:

FFmpeg
Chromium
required system fonts
Playwright dependencies
HyperFrames dependencies

⸻

71. FONT MANAGEMENT

Rendering consistency requires controlled fonts.

Do not rely on arbitrary operating-system fonts.

Bundle or install licensed project fonts.

Pin:

font file
font weight
fallback

for consistent server rendering.

⸻

72. DEPLOYMENT ARCHITECTURE

Avoid deploying heavy video rendering purely as short-lived serverless functions.

Recommended production architecture:

Web Application
        ↓
PostgreSQL
        ↓
Redis Queue
        ↓
Dedicated Worker
        ↓
Claude / Higgsfield
        ↓
HyperFrames / Playwright / FFmpeg
        ↓
Object Storage

Web hosting and rendering infrastructure may be separate.

⸻

73. WORKER RESOURCE LIMITS

Rendering workers need controlled limits.

Configure:

CPU
memory
disk workspace
job timeout
concurrency
cleanup

Temporary working directories must be deleted after successful upload.

⸻

74. PRIVACY AND DATA RETENTION

Define:

asset retention period
deleted-project behavior
provider data policies
temporary-file cleanup

Deleting a project should eventually delete:

database data
stored source images
generated videos
brochure
temporary assets

subject to backup retention policies.

⸻

75. SECURITY BASELINE

Implement:

input validation
authorization
CSRF protection where relevant
SSRF protection
rate limiting
secure headers
signed asset URLs
secret isolation
dependency auditing
file validation

Do not allow arbitrary user-provided URLs to be passed directly into FFmpeg.

⸻

76. COMMAND EXECUTION SECURITY

Never build shell commands by concatenating user-controlled strings.

Prefer safe process execution.

Arguments should be passed as arrays.

All filenames should be generated internally.

⸻

77. FEATURE FLAGS

Use feature flags for experimental functionality.

Examples:

VOICEOVER
MULTIPLE_REEL_VARIANTS
AUTO_PUBLISH
AI_MUSIC
ALT_VIDEO_PROVIDER

⸻

78. PHASE-BY-PHASE IMPLEMENTATION ROADMAP

⸻

PHASE 0 — TECHNICAL VALIDATION

Objective

Validate all external dependencies before significant development.

Tasks

Verify:

Higgsfield API access
Higgsfield authentication
Higgsfield image-to-video functionality
Claude API access
HyperFrames local rendering
FFmpeg installation
Playwright Rightmove access
Rightmove extraction feasibility
object storage

Build

Small isolated proof-of-concept scripts only.

No application architecture yet beyond integration tests.

Definition of Done

One Rightmove property can be:

opened
parsed
images discovered
one image analyzed
one image animated
one HyperFrames composition rendered
one FFmpeg output generated

All provider limitations documented.

⸻

PHASE 1 — PROJECT FOUNDATION

Objective

Create clean production architecture.

Build

monorepo
TypeScript configuration
linting
formatting
environment validation
Next.js app
worker
PostgreSQL
Redis
object storage abstraction
logging
Docker

Definition of Done

Application boots locally.

Worker runs.

Database migrations work.

Queue processes test jobs.

Storage uploads/downloads test files.

⸻

PHASE 2 — LISTING INGESTION

Objective

Import Rightmove listings reliably.

Build

ListingProvider interface
RightmoveListingProvider
URL validator
Playwright browser service
listing parser
property normalization
media extractor
image downloader
listing snapshot

Tests

Use fixture listings plus live smoke test.

Definition of Done

User enters a supported Rightmove URL and receives a normalized property project with locally controlled media.

⸻

PHASE 3 — PROPERTY REVIEW UI

Objective

Allow human verification before spending AI credits.

Build

property detail page
photo gallery
property facts
floorplans
edit/correct fields
remove unwanted photos

Definition of Done

User can inspect and correct imported information.

⸻

PHASE 4 — CLAUDE VISION

Objective

Understand property images and positioning.

Build

VisionProvider
ClaudeVisionProvider
image analysis schema
batch analysis
property marketing brief
factual validation
image scoring

Definition of Done

Every usable image has structured analysis and the property has a structured marketing brief.

⸻

PHASE 5 — STORYBOARD ENGINE

Objective

Transform analysis into a cinematic reel plan.

Build

storyboard schemas
scene selector
room diversity logic
scene sequencing
copy generator
motion selector
prompt generator
storyboard editor UI

Definition of Done

User receives a complete editable reel storyboard before video generation.

⸻

PHASE 6 — HIGGSFIELD VIDEO GENERATION

Objective

Create cinematic clips from approved photos.

Build

VideoGenerationProvider
HiggsfieldProvider
provider job persistence
polling/webhooks as supported
downloads
retries
cost tracking
scene regeneration

Definition of Done

Storyboard scenes can independently produce and persist usable video clips.

⸻

PHASE 7 — HYPERFRAMES REEL SYSTEM

Objective

Turn generated clips and property data into a polished branded reel.

Build

HyperFramesRenderer
base composition
brand system
animated typography
price overlays
feature cards
CTA
transitions
template system

Definition of Done

A complete reel composition can be rendered deterministically from project data.

⸻

PHASE 8 — FFMPEG FINALIZATION

Objective

Produce distribution-ready social video.

Build

clip normalization
audio processing
music
final encode
thumbnail
FFprobe validation

Final Reel

Target:

1080 × 1920
9:16
H.264
AAC
30 FPS
MP4

Definition of Done

Finished reel passes automated media validation.

⸻

PHASE 9 — DIGITAL BROCHURE

Objective

Generate polished property presentation.

Build

brochure component system
brand system
property content sections
gallery
floorplan
agent CTA
responsive animations
PDF CSS

Definition of Done

Project produces:

interactive brochure
+
high-quality PDF

⸻

PHASE 10 — PLAYWRIGHT BROCHURE RENDERING

Objective

Produce deterministic brochure output.

Build

font loading checks
asset loading checks
layout validation
screenshots
PDF rendering
visual regression tests

Definition of Done

Brochure renders identically in the controlled production environment.

⸻

PHASE 11 — GENERATION DASHBOARD

Objective

Create usable end-to-end product experience.

Build

generation progress
job statuses
asset previews
error recovery
regeneration
downloads
project history

Definition of Done

A nontechnical user can perform the entire generation workflow.

⸻

PHASE 12 — PRODUCTION HARDENING

Objective

Make the application safe and reliable.

Build

authentication
authorization
rate limits
SSRF protection
provider concurrency controls
retry policies
structured logs
error monitoring
cost ceilings
storage cleanup
backups

Definition of Done

Application passes production-readiness checklist.

⸻

PHASE 13 — TESTING AND QA

Objective

Validate complete workflow.

Test Properties

Use properties covering:

flat
detached house
luxury home
small listing
large listing
missing floorplan
poor photographs
many photographs
missing metadata
removed listing

Definition of Done

All critical workflows pass automated and manual QA.

⸻

PHASE 14 — DEPLOYMENT

Objective

Launch production infrastructure.

Deploy

web application
database
Redis
workers
object storage
monitoring
domains
SSL
backups

Definition of Done

Production user can generate a complete property marketing package.

⸻

79. FUTURE FEATURES

Design architecture so the following can later be introduced:

Zoopla imports
OnTheMarket imports
MLS imports
CSV import
manual property creation
automatic Instagram publishing
automatic TikTok publishing
Facebook publishing
YouTube Shorts
AI voice-over
AI avatar agent intro
AI music
multiple reel styles
automatic landscape video
4:5 Instagram ads
square ads
agent CRM integrations
white-label accounts
team accounts
usage billing
agency subscriptions
multiple video-generation providers
automatic provider selection
property website generation
lead-capture landing pages
QR codes
analytics

⸻

80. MAJOR RISKS

Risk 1 — Rightmove Access

The site may change or restrict automated access.

Mitigation

Provider abstraction plus manual/alternate import options.

⸻

Risk 2 — Higgsfield API

Access or functionality may not match assumptions.

Mitigation

Validate before building dependent stages.

Provider abstraction is mandatory.

⸻

Risk 3 — AI Hallucination

Vision/copy models may invent property facts.

Mitigation

Structured evidence classification and factual verification.

⸻

Risk 4 — Video Hallucination

Image-to-video may physically change the property.

Mitigation

Conservative prompts, QA, regeneration, manual approval.

⸻

Risk 5 — Generation Costs

Repeated video generation may become expensive.

Mitigation

Draft mode, caching, cost tracking, generation limits.

⸻

Risk 6 — Rendering Infrastructure

Video rendering can consume substantial CPU/RAM.

Mitigation

Dedicated worker architecture with controlled concurrency.

⸻

Risk 7 — Rendering Consistency

Browser/font/environment differences may alter output.

Mitigation

Dockerized pinned rendering environment and visual regression tests.

⸻

81. IMPORTANT ARCHITECTURAL DECISIONS

The following principles should NOT be compromised during implementation:

1. Provider-specific code stays behind provider interfaces.
2. Heavy work runs asynchronously through workers.
3. Original source assets remain immutable.
4. Structured AI output is schema validated.
5. Property facts are never invented.
6. Generated video must not be considered factual evidence.
7. Every pipeline stage is independently retryable.
8. Expensive results are cached.
9. External media is copied into controlled storage.
10. Rendering is deterministic wherever generative AI is not required.
11. User input never directly becomes shell commands.
12. Browser extraction is isolated from domain logic.
13. Templates are data-driven.
14. Production outputs undergo automated validation.
15. Users retain the ability to review and regenerate assets.

⸻

82. INITIAL MVP DEFINITION

The first usable version should deliberately focus on one strong workflow.

Input:

One Rightmove listing URL

Output:

One 20–30 second 9:16 reel
One interactive digital brochure
One PDF brochure

MVP reel:

5–8 selected photographs
AI analysis
cinematic generated motion
animated property titles
price
3–5 key features
music
agency branding
CTA

Do NOT initially build:

social posting
billing
CRM integrations
multiple listing portals
AI avatars
automatic voiceover
multi-language
large team permissions
advanced analytics

Those belong after the core content-generation engine is proven.

⸻

83. SUCCESS CRITERIA

The system is successful when a user can:

1. Paste a valid Rightmove URL.
2. Import the correct property facts.
3. Import its original photographs.
4. Review the imported data.
5. Run AI analysis.
6. Receive an intelligent storyboard.
7. Generate cinematic property scenes.
8. Preview those scenes.
9. Regenerate bad scenes.
10. Render a branded social reel.
11. Generate a branded digital brochure.
12. Export a PDF brochure.
13. Download the final reel.
14. Repeat the process for another property without developer involvement.

⸻

84. DEFINITION OF PRODUCTION QUALITY

The project is NOT production-ready merely because the happy-path demo works.

Production-ready means:

typed
tested
observable
retryable
secure
modular
documented
deployable
recoverable
cost-controlled

A failed API request must not destroy a project.

A changed Rightmove page must not require rewriting the application.

A failed scene should not force the entire reel to restart.

A provider should be replaceable.

A generated claim must be traceable to source information.

A final media file must be validated before being offered for download.

⸻

85. DEVELOPMENT RULES FOR CLAUDE CODE

Claude Code must follow these rules during implementation.

Rule 1

Read this entire technical plan before changing files.

Rule 2

Implement one phase at a time.

Rule 3

Before beginning each phase, state:

phase objective
files being created
files being modified
dependencies involved
expected result

Rule 4

Do not silently change the architecture.

Rule 5

Do not replace a specified provider simply because another service is easier.

Request approval first.

Rule 6

Do not fabricate provider APIs or SDK methods.

Consult current official documentation before integrating any external API.

Rule 7

Do not automate a provider's website as a hidden substitute for a missing official API without approval.

Rule 8

Create abstractions before provider implementations.

Rule 9

Do not place unrelated responsibilities in giant service files.

Rule 10

Write tests alongside important business logic.

Rule 11

Use strict TypeScript.

Rule 12

Document non-obvious architectural decisions.

Rule 13

After each phase:

run typecheck
run lint
run relevant tests
report failures

Rule 14

Do not claim a phase is complete if tests are failing.

Rule 15

Do not continue into the next phase without approval unless the user explicitly authorizes continuous phase-by-phase development.

⸻

86. PHASE 0 INSTRUCTIONS FOR CLAUDE CODE

When this file is first added to the repository:

DO NOT BEGIN BUILDING THE APPLICATION.

First:

1. Read this file completely.
2. Inspect the repository.
3. Verify whether the repository is empty.
4. Investigate every required external integration.
5. Verify actual current API availability.
6. Identify anything in this plan that cannot currently be implemented as written.
7. Identify architectural improvements.
8. Identify security concerns.
9. Identify deployment risks.
10. Identify missing decisions.
11. Produce the final implementation roadmap.

Separate findings into:

CONFIRMED
ASSUMPTIONS
RISKS
RECOMMENDATIONS
BLOCKERS

Then provide:

DECISIONS REQUIRED BEFORE DEVELOPMENT

STOP.

Do not create application code until approval is explicitly provided.

⸻

87. DECISIONS REQUIRED BEFORE DEVELOPMENT

Before Phase 1 development begins, resolve these items:

1. Higgsfield Access

Confirm whether the account has official programmatic/API access to the required image-to-video functionality.

This is the most important integration question.

2. Rightmove Usage

Confirm that the intended use of Rightmove property information and photographs is authorized for the user's business/workflow.

3. Brand Model

Decide whether version 1 supports:

one fixed company brand

or

multiple agent/agency brand profiles

Recommendation:

Build the underlying BrandProfile architecture immediately even if version 1 exposes only one profile.

4. User Authentication

Decide whether MVP is:

private single-user tool

or

multi-user SaaS

Recommendation:

Keep the database account-aware from day one even if authentication starts simple.

5. Infrastructure

Choose production providers for:

PostgreSQL
Redis
object storage
web hosting
render workers

This decision does not need to block early local development.

6. Reel Style

Choose the first production template.

Recommendation:

Premium / modern / cinematic

with restrained typography rather than aggressive AI-style visual effects.

7. Human Approval

Determine whether video generation begins:

automatically after analysis

or

only after storyboard approval

Recommendation:

Require storyboard approval for MVP because video generation is the expensive and least deterministic stage.

⸻

FINAL DEVELOPMENT ORDER

The implementation order must be:

0. Validate external integrations
1. Foundation
2. Rightmove ingestion
3. Property review
4. Claude Vision
5. Marketing intelligence
6. Storyboard
7. Higgsfield integration
8. Scene review
9. HyperFrames reel composition
10. FFmpeg final processing
11. Digital brochure
12. PDF generation
13. Generation dashboard
14. Production hardening
15. QA
16. Deployment

Do not reverse this sequence simply to produce a flashy demo earlier.

The central engineering objective is not merely:

generate a real-estate video

The objective is:

build a reliable property-media generation engine whose generative components can change over time while the underlying data, orchestration, rendering, and product architecture remain stable.
