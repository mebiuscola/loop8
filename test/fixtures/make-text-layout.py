"""Developer-only font/soft-break/autofit regression fixtures. No Python at runtime."""
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.enum.text import MSO_AUTO_SIZE
from pptx.oxml.xmlchemy import OxmlElement
p=Presentation();p.slide_width=Inches(13.333333);p.slide_height=Inches(7.5)
texts=['One title\n\nSecond title','A long paragraph requiring automatic shrink. '*12,'A long paragraph requiring automatic shrink. '*12,'Explicit authored font scale','Bullet link\nAnother bullet','Bold and regular mixed fonts']
for i,text in enumerate(texts):
 s=p.slides.add_slide(p.slide_layouts[6]);shape=s.shapes.add_textbox(Inches(1),Inches(1),Inches(5),Inches(1.7 if i in [1,2] else 3.5));tf=shape.text_frame;tf.word_wrap=True;tf.text=text;tf.auto_size=MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE if i!=2 else MSO_AUTO_SIZE.NONE
 for para in tf.paragraphs:
  para.font.name='Aptos';para.font.size=Pt(32 if i!=0 else 40)
 if i==3:shape._element.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}normAutofit').set('fontScale','70000')
 if i==4:
  for para in tf.paragraphs:
   pr=para._p.get_or_add_pPr();pr.set('marL','0');bu=OxmlElement('a:buChar');bu.set('char','•');pr.append(bu);pr.set('indent','-228600')
 if i==5:
  tf.paragraphs[0].runs[0].font.bold=True;run=tf.paragraphs[0].add_run();run.text=' and italic';run.font.name='Aptos';run.font.italic=True;run.font.size=Pt(26)
p.save(Path(__file__).with_name('text-layout.pptx'))
